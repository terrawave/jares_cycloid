#include <HardwareSerial.h>
#include <PZEM004Tv30.h>
#include <Preferences.h>
#include <esp_now.h>
#include <WiFi.h>
#include <ArduinoJson.h>

// Preferences 객체
Preferences preferences;

// PZEM-004T V3.0 모듈용 통신 설정
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17
#define PZEM_SERIAL Serial2
PZEM004Tv30 pzem(PZEM_SERIAL, PZEM_RX_PIN, PZEM_TX_PIN);

// 74HC595 시프트 레지스터 제어 핀
const int dataPin = 14;
const int latchPin = 12;
const int clockPin = 13;
const int oePin = 5;

// 센서 핀 정의
#define MOTOR_SPEED_PIN 34
#define PROXIMITY_PIN 18

// 릴레이 상태 저장
uint16_t relayStates = 0x0000;
uint16_t lastSavedRelayStates = 0x0000;
uint32_t saveCount = 0;

// ========== ESP-NOW 구조체 ==========
// 메시지 타입
enum MessageType {
  MSG_SENSOR_DATA = 1,
  MSG_PAIRING_REQUEST = 2,
  MSG_PAIRING_RESPONSE = 3,
  MSG_COMMAND = 4
};

// 페어링 메시지 구조체
typedef struct {
  uint8_t msgType;
  char deviceName[32];
  uint8_t macAddr[6];
} PairingMessage;

// 센서 데이터 구조체
typedef struct {
  uint8_t msgType;
  char deviceName[32];
  float temperature;
  float humidity;
  int co2;
  float lux;
  uint32_t timestamp;
  uint8_t macAddr[6];
} SensorData;

// 슬레이브 정보 구조체
typedef struct {
  char deviceName[32];
  uint8_t macAddr[6];
  bool paired;
  bool connected;
  unsigned long lastUpdate;
  unsigned long lastDataReceived;  // 실제 데이터 수신 시간
  unsigned long pairingCount;      // 페어링 횟수
  unsigned long dataCount;         // 데이터 수신 횟수
  SensorData lastData;
} SlaveInfo;

// 슬레이브 관리
#define MAX_SLAVES 10
SlaveInfo slaves[MAX_SLAVES];
int slaveCount = 0;
const unsigned long SLAVE_TIMEOUT = 60000;

// 브로드캐스트 주소
uint8_t broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ========== 모터 릴레이 정의 ==========
// 속도 (3중 1개만 선택)
#define RELAY_MOTOR_SPEED1 0
#define RELAY_MOTOR_SPEED2 1
#define RELAY_MOTOR_SPEED3 2

// 방향 (정회전/역회전 중 1개, 둘 다 OFF=정지)
#define RELAY_MOTOR_FORWARD 8
#define RELAY_MOTOR_REVERSE 9

// 밸브
#define RELAY_WATER_VALVE 4   // 급수밸브
#define RELAY_DRAIN_VALVE 3   // 배수밸브

// ========== 자동 급수/배수 공통 구조체 ==========
struct AutoSystemConfig {
  uint32_t delayA;          // 연속 감지 필요 시간 (초)
  uint32_t durationB;       // 급수/배수 시간 (초)
  uint16_t cycleCount;
  bool enabled;
  bool running;
  uint16_t currentCycle;

  enum State {
    IDLE,
    WAIT_SENSOR,
    SENSOR_HOLD,    // 연속 감지 확인 상태 (새로 추가)
    PROCESSING,
    CYCLE_COMPLETE
  } state;

  unsigned long stateStartTime;
  unsigned long sensorDetectedTime;  // 센서 감지 시작 시간 (새로 추가)
  bool sensorDetected;
};

AutoSystemConfig autoWatering;
AutoSystemConfig autoDrain;

// 기타 변수들
unsigned long lastRelayChange = 0;
const unsigned long AUTO_SAVE_DELAY = 30000;
bool pendingSave = false;

const int MAX_SAVES_PER_DAY = 100;
uint16_t dailySaveCount = 0;
uint32_t lastDayReset = 0;
uint32_t lastSaveTime = 0;

float voltage = 0;
float current = 0;
float power = 0;
float energy = 0;
float frequency = 0;
float pf = 0;
int motorSpeedValue = 0;
bool proximityState = false;

String inputString = "";
bool monitorMode = false;
unsigned long monitorInterval = 1000;
bool debugMode = false;
bool pairingMode = true;

// 디버깅용 변수 추가
unsigned long totalMessagesReceived = 0;
unsigned long lastDebugOutput = 0;
volatile bool proximityChanged = false;
volatile bool proximityInterruptState = false;

// ========== 함수 선언 (Forward Declaration) ==========
void loadSlaveInfo();
void saveSlaveInfo();
void loadAutoWateringConfig();
void saveAutoWateringConfig();
void loadAutoDrainConfig();
void saveAutoDrainConfig();
void startAutoWatering();
void stopAutoWatering();
void processAutoWatering();
void startAutoDrain();
void stopAutoDrain();
void processAutoDrain();
void setMotorSpeed(int speed);
void setMotorDirection(int dir);
void stopMotor();
void updateShiftRegisters();
void quickTest();
void setRelay(int relayNum, bool state);
bool getRelayState(int relayNum);
void setAllRelays(bool state);
void loadRelayStates();
void saveRelayStates(bool force = false);
void scanRelays();
void handleSerialCommand();
void readSensors();
void printWaterStatus();
void printDrainStatus();
void printSlaveStatus();
void printStatus();
void printHelp();
void sendJSON();
void checkSlaveConnections();
void processCommand(String cmd);
void printDebugInfo();

// ========== ESP-NOW 콜백 함수 ==========
void OnDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *data, int data_len) {
  const uint8_t *mac_addr = recv_info->src_addr;
  totalMessagesReceived++;

  if (data_len < 1) return;

  uint8_t msgType = data[0];

  // 디버깅: 모든 수신 메시지 로그
  if (debugMode) {
    Serial.print("[DEBUG] Msg type ");
    Serial.print(msgType);
    Serial.print(" from ");
    for (int i = 0; i < 6; i++) {
      Serial.printf("%02X", mac_addr[i]);
      if (i < 5) Serial.print(":");
    }
    Serial.print(" (size: ");
    Serial.print(data_len);
    Serial.println(" bytes)");
  }

  switch (msgType) {
    case MSG_PAIRING_REQUEST: {
      if (!pairingMode) {
        if (debugMode) Serial.println("[DEBUG] Pairing disabled, ignoring");
        return;
      }

      if (data_len != sizeof(PairingMessage)) {
        Serial.print("[ERROR] Wrong pairing msg size: ");
        Serial.println(data_len);
        return;
      }

      PairingMessage pairMsg;
      memcpy(&pairMsg, data, sizeof(pairMsg));

      // 기존 장치인지 확인 (이름으로)
      int existingIndex = -1;
      for (int i = 0; i < slaveCount; i++) {
        if (strcmp(slaves[i].deviceName, pairMsg.deviceName) == 0) {
          existingIndex = i;
          break;
        }
      }

      if (existingIndex >= 0) {
        // MAC 주소 업데이트
        memcpy(slaves[existingIndex].macAddr, mac_addr, 6);
        slaves[existingIndex].paired = true;
        slaves[existingIndex].connected = true;
        slaves[existingIndex].lastUpdate = millis();
        slaves[existingIndex].pairingCount++;

        if (debugMode) {
          Serial.print("♻️ Re-paired: ");
          Serial.print(pairMsg.deviceName);
          Serial.print(" (count: ");
          Serial.print(slaves[existingIndex].pairingCount);
          Serial.println(")");
        }
      } else if (slaveCount < MAX_SLAVES) {
        // 새 장치 추가
        strcpy(slaves[slaveCount].deviceName, pairMsg.deviceName);
        memcpy(slaves[slaveCount].macAddr, mac_addr, 6);
        slaves[slaveCount].paired = true;
        slaves[slaveCount].connected = true;
        slaves[slaveCount].lastUpdate = millis();
        slaves[slaveCount].pairingCount = 1;
        slaves[slaveCount].dataCount = 0;

        esp_now_peer_info_t peerInfo;
        memset(&peerInfo, 0, sizeof(peerInfo));
        memcpy(peerInfo.peer_addr, mac_addr, 6);
        peerInfo.channel = 0;
        peerInfo.encrypt = false;

        if (!esp_now_is_peer_exist(mac_addr)) {
          esp_now_add_peer(&peerInfo);
        }

        slaveCount++;

        Serial.print("✅ New device paired: ");
        Serial.print(pairMsg.deviceName);
        Serial.print(" [");
        for (int i = 0; i < 6; i++) {
          Serial.printf("%02X", mac_addr[i]);
          if (i < 5) Serial.print(":");
        }
        Serial.println("]");
      }

      // 페어링 응답 전송
      PairingMessage response;
      response.msgType = MSG_PAIRING_RESPONSE;
      strcpy(response.deviceName, "MASTER");
      WiFi.macAddress(response.macAddr);

      esp_err_t result = esp_now_send(mac_addr, (uint8_t*)&response, sizeof(response));
      if (debugMode) {
        Serial.print("[DEBUG] Pairing response sent: ");
        Serial.println(result == ESP_OK ? "OK" : "FAIL");
      }

      break;
    }

    case MSG_SENSOR_DATA: {
      if (data_len != sizeof(SensorData)) {
        Serial.print("[ERROR] Wrong data size! Expected: ");
        Serial.print(sizeof(SensorData));
        Serial.print(", Got: ");
        Serial.println(data_len);
        return;
      }

      SensorData receivedData;
      memcpy(&receivedData, data, sizeof(SensorData));

      // 해당 슬레이브 찾기 (MAC 주소로)
      int deviceIndex = -1;
      for (int i = 0; i < slaveCount; i++) {
        if (memcmp(slaves[i].macAddr, mac_addr, 6) == 0) {
          deviceIndex = i;
          break;
        }
      }

      // 못 찾으면 장치 이름으로 찾기
      if (deviceIndex == -1) {
        for (int i = 0; i < slaveCount; i++) {
          if (strcmp(slaves[i].deviceName, receivedData.deviceName) == 0) {
            // MAC 주소 업데이트
            memcpy(slaves[i].macAddr, mac_addr, 6);
            deviceIndex = i;
            Serial.print("📝 Updated MAC for ");
            Serial.println(receivedData.deviceName);
            break;
          }
        }
      }

      // 그래도 못 찾으면 자동 페어링 (새 장치)
      if (deviceIndex == -1 && slaveCount < MAX_SLAVES) {
        // 새 슬레이브 자동 추가
        strcpy(slaves[slaveCount].deviceName, receivedData.deviceName);
        memcpy(slaves[slaveCount].macAddr, mac_addr, 6);
        slaves[slaveCount].paired = true;
        slaves[slaveCount].connected = true;
        slaves[slaveCount].lastUpdate = millis();
        slaves[slaveCount].lastDataReceived = millis();
        slaves[slaveCount].pairingCount = 0;
        slaves[slaveCount].dataCount = 1;
        slaves[slaveCount].lastData = receivedData;

        // ESP-NOW 피어 추가
        esp_now_peer_info_t peerInfo;
        memset(&peerInfo, 0, sizeof(peerInfo));
        memcpy(peerInfo.peer_addr, mac_addr, 6);
        peerInfo.channel = 0;
        peerInfo.encrypt = false;

        if (!esp_now_is_peer_exist(mac_addr)) {
          esp_now_add_peer(&peerInfo);
        }

        deviceIndex = slaveCount;
        slaveCount++;

        Serial.print("🆕 Auto-paired new device: ");
        Serial.print(receivedData.deviceName);
        Serial.print(" [");
        for (int i = 0; i < 6; i++) {
          Serial.printf("%02X", mac_addr[i]);
          if (i < 5) Serial.print(":");
        }
        Serial.println("]");

        // 페어링 응답 전송
        PairingMessage response;
        response.msgType = MSG_PAIRING_RESPONSE;
        strcpy(response.deviceName, "MASTER");
        WiFi.macAddress(response.macAddr);
        esp_now_send(mac_addr, (uint8_t*)&response, sizeof(response));
      }

      // 데이터 저장 및 출력
      if (deviceIndex >= 0) {
        slaves[deviceIndex].lastData = receivedData;
        slaves[deviceIndex].connected = true;
        slaves[deviceIndex].lastUpdate = millis();
        slaves[deviceIndex].lastDataReceived = millis();
        slaves[deviceIndex].dataCount++;

        Serial.print("📊 Data from ");
        Serial.print(slaves[deviceIndex].deviceName);
        Serial.print(" (#");
        Serial.print(deviceIndex + 1);
        Serial.print(") - Temp: ");
        Serial.print(receivedData.temperature, 1);
        Serial.print("°C, Humidity: ");
        Serial.print(receivedData.humidity, 1);
        Serial.print("%, CO2: ");
        Serial.print(receivedData.co2);
        Serial.print("ppm, Lux: ");
        Serial.print(receivedData.lux, 0);
        Serial.print("lux (Count: ");
        Serial.print(slaves[deviceIndex].dataCount);
        Serial.println(")");
      }

      break;
    }

    default:
      if (debugMode) {
        Serial.print("[DEBUG] Unknown message type: ");
        Serial.println(msgType);
      }
      break;
  }
}

// ========== 디버그 정보 출력 ==========
void printDebugInfo() {
  Serial.println("\n========== DEBUG INFO ==========");
  Serial.print("Total messages received: ");
  Serial.println(totalMessagesReceived);
  Serial.print("Pairing mode: ");
  Serial.println(pairingMode ? "ENABLED" : "DISABLED");
  Serial.print("Debug mode: ");
  Serial.println(debugMode ? "ON" : "OFF");

  Serial.println("\n--- Slave Statistics ---");
  for (int i = 0; i < slaveCount; i++) {
    Serial.print("[");
    Serial.print(i + 1);
    Serial.print("] ");
    Serial.print(slaves[i].deviceName);
    Serial.print(" - Pairing count: ");
    Serial.print(slaves[i].pairingCount);
    Serial.print(", Data count: ");
    Serial.print(slaves[i].dataCount);

    if (slaves[i].lastDataReceived > 0) {
      Serial.print(", Last data: ");
      Serial.print((millis() - slaves[i].lastDataReceived) / 1000);
      Serial.print("s ago");
    }

    Serial.println();
  }
  Serial.println("================================");
}
void IRAM_ATTR onProximityChange() {
  proximityChanged = true;
  proximityInterruptState = !digitalRead(PROXIMITY_PIN);
}
// ========== Setup 함수 ==========
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n===========================================");
  Serial.println("ESP32 MASTER - Enhanced Debug Version");
  Serial.println("===========================================");

  WiFi.mode(WIFI_STA);
  Serial.print("Master MAC Address: ");
  Serial.println(WiFi.macAddress());

  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }
  pinMode(PROXIMITY_PIN, INPUT_PULLUP);

  // 인터럽트 연결
  attachInterrupt(digitalPinToInterrupt(PROXIMITY_PIN), onProximityChange, CHANGE);

  // 초기 상태 읽기
  proximityState = !digitalRead(PROXIMITY_PIN);

  esp_now_register_recv_cb(OnDataRecv);

  // 브로드캐스트 피어 추가
  esp_now_peer_info_t peerInfo;
  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  esp_now_add_peer(&peerInfo);

  Serial.println("ESP-NOW initialized successfully");
  Serial.println("Auto-pairing mode: ENABLED");
  Serial.print("Max slaves: ");
  Serial.println(MAX_SLAVES);
  Serial.print("SensorData size: ");
  Serial.print(sizeof(SensorData));
  Serial.println(" bytes");
  Serial.print("PairingMessage size: ");
  Serial.print(sizeof(PairingMessage));
  Serial.println(" bytes");

  // 하드웨어 핀 초기화
  pinMode(dataPin, OUTPUT);
  pinMode(clockPin, OUTPUT);
  pinMode(latchPin, OUTPUT);
  pinMode(oePin, OUTPUT);

  digitalWrite(dataPin, LOW);
  digitalWrite(clockPin, LOW);
  digitalWrite(latchPin, LOW);
  digitalWrite(oePin, LOW);

  pinMode(PROXIMITY_PIN, INPUT_PULLUP);
  pinMode(MOTOR_SPEED_PIN, INPUT);

  preferences.begin("relay", false);

  loadSlaveInfo();
  loadAutoWateringConfig();
  loadAutoDrainConfig();

  loadRelayStates();
  updateShiftRegisters();

  Serial.println("\nInitializing PZEM-004T V3.0...");
  delay(500);

  Serial.println("\n=== System Ready ===");
  Serial.println("Commands: HELP, STATUS, DEVICES, DEBUG");
  Serial.println("Waiting for sensor slaves...\n");

}

// ========== Loop 함수 ==========
void loop() {
  handleSerialCommand();

  // ✅ 인터럽트 방식 근접센서 처리
  if (proximityChanged) {
    proximityChanged = false;

    // 디바운싱
    delay(10);
    bool confirmedState = !digitalRead(PROXIMITY_PIN);

    if (confirmedState == proximityInterruptState) {
      proximityState = confirmedState;
      sendJSON();
    }
  }

  // 센서 읽기
  static unsigned long lastSensorRead = 0;
  if (millis() - lastSensorRead > 100) {
    lastSensorRead = millis();
    readSensors();
  }

  // 슬레이브 연결 체크
  checkSlaveConnections();

  // 자동 급수 처리
  processAutoWatering();

  // 자동 배수 처리
  processAutoDrain();

  // 모니터 모드
  if (monitorMode) {
    static unsigned long lastMonitor = 0;
    if (millis() - lastMonitor > monitorInterval) {
      lastMonitor = millis();
      sendJSON();
    }
  }

  // 디버그 정보 주기적 출력
  if (debugMode && millis() - lastDebugOutput > 10000) {
    lastDebugOutput = millis();
    printDebugInfo();
  }

  // 릴레이 상태 자동 저장
  if (pendingSave && lastRelayChange > 0 && !autoWatering.running && !autoDrain.running) {
    if ((millis() - lastRelayChange > AUTO_SAVE_DELAY) &&
        (millis() - lastSaveTime > 60000)) {
      saveRelayStates(false);
    }
  }

  // 일일 저장 카운트 리셋
  if (millis() - lastDayReset > 86400000UL) {
    dailySaveCount = 0;
    lastDayReset = millis();
    preferences.putUInt("dayReset", lastDayReset);
    preferences.putUShort("daily", 0);
  }
}

// ========== 릴레이 관련 함수 ==========
void updateShiftRegisters() {
  digitalWrite(latchPin, LOW);
  delayMicroseconds(10);
  shiftOut(dataPin, clockPin, MSBFIRST, (relayStates >> 8) & 0xFF);
  shiftOut(dataPin, clockPin, MSBFIRST, relayStates & 0xFF);
  digitalWrite(latchPin, HIGH);
  delayMicroseconds(10);

  if (relayStates != lastSavedRelayStates) {
    lastRelayChange = millis();
    pendingSave = true;
  }
}

void quickTest() {
  relayStates = 0x0000;
  updateShiftRegisters();
  delay(500);
  relayStates = 0xFFFF;
  updateShiftRegisters();
  delay(500);
  relayStates = 0x0000;
  updateShiftRegisters();
}

void setRelay(int relayNum, bool state) {
  if(relayNum < 0 || relayNum > 15) return;

  uint16_t oldStates = relayStates;

  if(state) {
    relayStates |= (1 << relayNum);
  } else {
    relayStates &= ~(1 << relayNum);
  }

  if(oldStates != relayStates) {
    updateShiftRegisters();
  }
}

bool getRelayState(int relayNum) {
  if(relayNum < 0 || relayNum > 15) return false;
  return (relayStates & (1 << relayNum)) != 0;
}

void setAllRelays(bool state) {
  relayStates = state ? 0xFFFF : 0x0000;
  updateShiftRegisters();
}

void loadRelayStates() {
  relayStates = preferences.getUShort("states", 0);
  lastSavedRelayStates = relayStates;
  saveCount = preferences.getUInt("count", 0);
  dailySaveCount = preferences.getUShort("daily", 0);
  lastDayReset = preferences.getUInt("dayReset", millis());

  if (millis() - lastDayReset > 86400000UL) {
    dailySaveCount = 0;
    lastDayReset = millis();
    preferences.putUInt("dayReset", lastDayReset);
    preferences.putUShort("daily", 0);
  }

  Serial.print("Loaded state: 0x");
  Serial.print(relayStates, HEX);
  Serial.print(" (Total saves: ");
  Serial.print(saveCount);
  Serial.print(", Today: ");
  Serial.print(dailySaveCount);
  Serial.println(")");
}

void saveRelayStates(bool force) {
  if (relayStates == lastSavedRelayStates && !force) {
    return;
  }

  if (!force && dailySaveCount >= MAX_SAVES_PER_DAY) {
    Serial.println("Daily save limit reached!");
    return;
  }

  if (!force && (millis() - lastSaveTime < 60000)) {
    pendingSave = true;
    return;
  }

  preferences.putUShort("states", relayStates);
  preferences.putUInt("count", ++saveCount);
  preferences.putUShort("daily", ++dailySaveCount);

  lastSavedRelayStates = relayStates;
  lastSaveTime = millis();
  pendingSave = false;

  Serial.print("Saved: 0x");
  Serial.print(relayStates, HEX);
  Serial.print(" (#");
  Serial.print(saveCount);
  Serial.println(")");
}

void scanRelays() {
  uint16_t originalState = relayStates;

  for(int i = 0; i < 16; i++) {
    Serial.print("Testing Relay ");
    Serial.print(i);
    Serial.print("...");
    relayStates = (1 << i);
    updateShiftRegisters();
    delay(300);
    Serial.println(" done");
  }

  relayStates = originalState;
  updateShiftRegisters();
}

// ========== 모터 제어 헬퍼 함수 ==========
void setMotorSpeed(int speed) {
  // 속도 0=정지, 1=속도1, 2=속도2, 3=속도3
  setRelay(RELAY_MOTOR_SPEED1, speed == 1);
  setRelay(RELAY_MOTOR_SPEED2, speed == 2);
  setRelay(RELAY_MOTOR_SPEED3, speed == 3);

  Serial.print("Motor speed set to: ");
  Serial.println(speed);
}

void setMotorDirection(int dir) {
  // 방향 0=정지, 1=정회전, 2=역회전
  setRelay(RELAY_MOTOR_FORWARD, dir == 1);
  setRelay(RELAY_MOTOR_REVERSE, dir == 2);

  Serial.print("Motor direction set to: ");
  if (dir == 0) Serial.println("STOP");
  else if (dir == 1) Serial.println("FORWARD");
  else if (dir == 2) Serial.println("REVERSE");
}

void stopMotor() {
  setMotorSpeed(0);
  setMotorDirection(0);
  Serial.println("Motor stopped");
}

// ========== 자동 급수 함수 ==========
void loadAutoWateringConfig() {
  autoWatering.delayA = preferences.getUInt("waterDelayA", 5);
  autoWatering.durationB = preferences.getUInt("waterDurationB", 10);
  autoWatering.cycleCount = preferences.getUShort("waterCycles", 81);
  autoWatering.enabled = false;
  autoWatering.running = false;
  autoWatering.currentCycle = 0;
  autoWatering.state = AutoSystemConfig::IDLE;

  Serial.print("Auto Watering Config: Delay=");
  Serial.print(autoWatering.delayA);
  Serial.print("s, Duration=");
  Serial.print(autoWatering.durationB);
  Serial.print("s, Cycles=");
  Serial.println(autoWatering.cycleCount);
}

void saveAutoWateringConfig() {
  preferences.putUInt("waterDelayA", autoWatering.delayA);
  preferences.putUInt("waterDurationB", autoWatering.durationB);
  preferences.putUShort("waterCycles", autoWatering.cycleCount);
  Serial.println("Auto watering config saved");
}

void startAutoWatering() {
  if (autoWatering.running) {
    Serial.println("Auto watering already running!");
    return;
  }

  // 배수 중이면 중지
  if (autoDrain.running) {
    stopAutoDrain();
  }

  Serial.println("\n=== AUTO WATERING STARTED ===");
  autoWatering.enabled = true;
  autoWatering.running = true;
  autoWatering.currentCycle = 0;
  autoWatering.state = AutoSystemConfig::WAIT_SENSOR;
  autoWatering.stateStartTime = millis();
  autoWatering.sensorDetected = false;

  setMotorDirection(1);  // 정회전
  setMotorSpeed(1);      // 속도1

  Serial.println("Motor started: Forward + Speed1");
  Serial.println("Waiting for proximity sensor...");
}

void stopAutoWatering() {
  if (!autoWatering.running) {
    return;
  }

  Serial.println("\n=== AUTO WATERING STOPPED ===");

  autoWatering.enabled = false;
  autoWatering.running = false;
  autoWatering.state = AutoSystemConfig::IDLE;

  stopMotor();
  setRelay(RELAY_WATER_VALVE, false);

  Serial.println("All motors and valves stopped");
}

void processAutoWatering() {
  if (!autoWatering.running) return;

  unsigned long currentTime = millis();
  unsigned long elapsedTime = currentTime - autoWatering.stateStartTime;

  switch (autoWatering.state) {
    case AutoSystemConfig::WAIT_SENSOR:
      // 센서 감지 시작
      if (proximityState && !autoWatering.sensorDetected) {
        autoWatering.sensorDetected = true;
        autoWatering.sensorDetectedTime = currentTime;
        Serial.print("\n[Water Cycle ");
        Serial.print(autoWatering.currentCycle + 1);
        Serial.print("/");
        Serial.print(autoWatering.cycleCount);
        Serial.println("] Sensor detected, checking hold...");
        autoWatering.state = AutoSystemConfig::SENSOR_HOLD;
      }
      break;

    case AutoSystemConfig::SENSOR_HOLD:
      // 연속 감지 확인 (delayA 초 동안 유지되어야 함)
      if (proximityState) {
        unsigned long holdTime = currentTime - autoWatering.sensorDetectedTime;
        if (holdTime >= autoWatering.delayA * 1000) {
          // ✅ 연속 감지 성공! 급수 시작
          Serial.print("Sensor held for ");
          Serial.print(autoWatering.delayA);
          Serial.println("s - Starting water supply!");
          setMotorDirection(0);  // 모터 정지
          setRelay(RELAY_WATER_VALVE, true);
          autoWatering.state = AutoSystemConfig::PROCESSING;
          autoWatering.stateStartTime = currentTime;
        }
        // 아직 홀드 중... (1초마다 로그)
        else if (holdTime > 0 && holdTime % 1000 < 100) {
          static unsigned long lastLog = 0;
          if (currentTime - lastLog > 900) {
            lastLog = currentTime;
            Serial.print("  Holding... ");
            Serial.print(holdTime / 1000);
            Serial.print("/");
            Serial.print(autoWatering.delayA);
            Serial.println("s");
          }
        }
      } else {
        // ❌ 센서 풀림 - 노이즈였음, 리셋
        Serial.println("Sensor released - resetting (noise?)");
        autoWatering.sensorDetected = false;
        autoWatering.state = AutoSystemConfig::WAIT_SENSOR;
      }
      break;

    case AutoSystemConfig::PROCESSING:
      if (elapsedTime >= autoWatering.durationB * 1000) {
        Serial.println("Water supply complete for this cycle.");
        setRelay(RELAY_WATER_VALVE, false);
        autoWatering.currentCycle++;

        if (autoWatering.currentCycle >= autoWatering.cycleCount) {
          Serial.println("\n=== ALL WATERING CYCLES COMPLETE ===");
          setMotorDirection(1);  // 정회전
          setMotorSpeed(1);      // 속도1
          autoWatering.running = false;
          autoWatering.state = AutoSystemConfig::IDLE;
        } else {
          Serial.println("Preparing for next cycle...");
          setMotorDirection(1);  // 정회전
          setMotorSpeed(1);      // 속도1
          autoWatering.state = AutoSystemConfig::WAIT_SENSOR;
          autoWatering.stateStartTime = currentTime;
          autoWatering.sensorDetected = false;
        }
      }
      break;
  }
}

void printWaterStatus() {
  Serial.print("Water Status: ");
  if (autoWatering.running) {
    Serial.print("RUNNING - ");
    switch(autoWatering.state) {
      case AutoSystemConfig::WAIT_SENSOR:
        Serial.print("Waiting for sensor");
        break;
      case AutoSystemConfig::SENSOR_HOLD:
        Serial.print("Sensor hold (");
        Serial.print((millis() - autoWatering.sensorDetectedTime) / 1000);
        Serial.print("/");
        Serial.print(autoWatering.delayA);
        Serial.print("s)");
        break;
      case AutoSystemConfig::PROCESSING:
        Serial.print("Watering");
        break;
      default:
        Serial.print("Processing");
    }
    Serial.print(" - Cycle ");
    Serial.print(autoWatering.currentCycle + 1);
    Serial.print("/");
    Serial.println(autoWatering.cycleCount);
  } else {
    Serial.println("IDLE");
  }

  Serial.print("Config: Delay=");
  Serial.print(autoWatering.delayA);
  Serial.print("s, Duration=");
  Serial.print(autoWatering.durationB);
  Serial.print("s, Cycles=");
  Serial.println(autoWatering.cycleCount);
}

// ========== 자동 배수 함수 ==========
void loadAutoDrainConfig() {
  autoDrain.delayA = preferences.getUInt("drainDelayA", 5);
  autoDrain.durationB = preferences.getUInt("drainDurationB", 10);
  autoDrain.cycleCount = preferences.getUShort("drainCycles", 81);
  autoDrain.enabled = false;
  autoDrain.running = false;
  autoDrain.currentCycle = 0;
  autoDrain.state = AutoSystemConfig::IDLE;

  Serial.print("Auto Drain Config: Delay=");
  Serial.print(autoDrain.delayA);
  Serial.print("s, Duration=");
  Serial.print(autoDrain.durationB);
  Serial.print("s, Cycles=");
  Serial.println(autoDrain.cycleCount);
}

void saveAutoDrainConfig() {
  preferences.putUInt("drainDelayA", autoDrain.delayA);
  preferences.putUInt("drainDurationB", autoDrain.durationB);
  preferences.putUShort("drainCycles", autoDrain.cycleCount);
  Serial.println("Auto drain config saved");
}

void startAutoDrain() {
  if (autoDrain.running) {
    Serial.println("Auto drain already running!");
    return;
  }

  // 급수 중이면 중지
  if (autoWatering.running) {
    stopAutoWatering();
  }

  Serial.println("\n=== AUTO DRAIN STARTED ===");
  autoDrain.enabled = true;
  autoDrain.running = true;
  autoDrain.currentCycle = 0;
  autoDrain.state = AutoSystemConfig::WAIT_SENSOR;
  autoDrain.stateStartTime = millis();
  autoDrain.sensorDetected = false;

  setMotorDirection(2);  // 역회전
  setMotorSpeed(1);      // 속도1

  Serial.println("Motor started: Reverse + Speed1");
  Serial.println("Waiting for proximity sensor...");
}

void stopAutoDrain() {
  if (!autoDrain.running) {
    return;
  }

  Serial.println("\n=== AUTO DRAIN STOPPED ===");

  autoDrain.enabled = false;
  autoDrain.running = false;
  autoDrain.state = AutoSystemConfig::IDLE;

  stopMotor();
  setRelay(RELAY_DRAIN_VALVE, false);

  Serial.println("All motors and valves stopped");
}

void processAutoDrain() {
  if (!autoDrain.running) return;

  unsigned long currentTime = millis();
  unsigned long elapsedTime = currentTime - autoDrain.stateStartTime;

  switch (autoDrain.state) {
    case AutoSystemConfig::WAIT_SENSOR:
      // 센서 감지 시작
      if (proximityState && !autoDrain.sensorDetected) {
        autoDrain.sensorDetected = true;
        autoDrain.sensorDetectedTime = currentTime;
        Serial.print("\n[Drain Cycle ");
        Serial.print(autoDrain.currentCycle + 1);
        Serial.print("/");
        Serial.print(autoDrain.cycleCount);
        Serial.println("] Sensor detected, checking hold...");
        autoDrain.state = AutoSystemConfig::SENSOR_HOLD;
      }
      break;

    case AutoSystemConfig::SENSOR_HOLD:
      // 연속 감지 확인 (delayA 초 동안 유지되어야 함)
      if (proximityState) {
        unsigned long holdTime = currentTime - autoDrain.sensorDetectedTime;
        if (holdTime >= autoDrain.delayA * 1000) {
          // ✅ 연속 감지 성공! 배수 시작
          Serial.print("Sensor held for ");
          Serial.print(autoDrain.delayA);
          Serial.println("s - Starting drain!");
          setMotorDirection(0);  // 모터 정지
          setRelay(RELAY_DRAIN_VALVE, true);
          autoDrain.state = AutoSystemConfig::PROCESSING;
          autoDrain.stateStartTime = currentTime;
        }
        // 아직 홀드 중... (1초마다 로그)
        else if (holdTime > 0 && holdTime % 1000 < 100) {
          static unsigned long lastDrainLog = 0;
          if (currentTime - lastDrainLog > 900) {
            lastDrainLog = currentTime;
            Serial.print("  Holding... ");
            Serial.print(holdTime / 1000);
            Serial.print("/");
            Serial.print(autoDrain.delayA);
            Serial.println("s");
          }
        }
      } else {
        // ❌ 센서 풀림 - 노이즈였음, 리셋
        Serial.println("Sensor released - resetting (noise?)");
        autoDrain.sensorDetected = false;
        autoDrain.state = AutoSystemConfig::WAIT_SENSOR;
      }
      break;

    case AutoSystemConfig::PROCESSING:
      if (elapsedTime >= autoDrain.durationB * 1000) {
        Serial.println("Drain complete for this cycle.");
        setRelay(RELAY_DRAIN_VALVE, false);
        autoDrain.currentCycle++;

        if (autoDrain.currentCycle >= autoDrain.cycleCount) {
          Serial.println("\n=== ALL DRAIN CYCLES COMPLETE ===");
          setMotorDirection(2);  // 역회전
          setMotorSpeed(1);      // 속도1
          autoDrain.running = false;
          autoDrain.state = AutoSystemConfig::IDLE;
        } else {
          Serial.println("Preparing for next cycle...");
          setMotorDirection(2);  // 역회전
          setMotorSpeed(1);      // 속도1
          autoDrain.state = AutoSystemConfig::WAIT_SENSOR;
          autoDrain.stateStartTime = currentTime;
          autoDrain.sensorDetected = false;
        }
      }
      break;
  }
}

void printDrainStatus() {
  Serial.print("Drain Status: ");
  if (autoDrain.running) {
    Serial.print("RUNNING - ");
    switch(autoDrain.state) {
      case AutoSystemConfig::WAIT_SENSOR:
        Serial.print("Waiting for sensor");
        break;
      case AutoSystemConfig::SENSOR_HOLD:
        Serial.print("Sensor hold (");
        Serial.print((millis() - autoDrain.sensorDetectedTime) / 1000);
        Serial.print("/");
        Serial.print(autoDrain.delayA);
        Serial.print("s)");
        break;
      case AutoSystemConfig::PROCESSING:
        Serial.print("Draining");
        break;
      default:
        Serial.print("Processing");
    }
    Serial.print(" - Cycle ");
    Serial.print(autoDrain.currentCycle + 1);
    Serial.print("/");
    Serial.println(autoDrain.cycleCount);
  } else {
    Serial.println("IDLE");
  }

  Serial.print("Config: Delay=");
  Serial.print(autoDrain.delayA);
  Serial.print("s, Duration=");
  Serial.print(autoDrain.durationB);
  Serial.print("s, Cycles=");
  Serial.println(autoDrain.cycleCount);
}

// ========== 슬레이브 관련 함수 ==========
void checkSlaveConnections() {
  unsigned long currentTime = millis();

  for (int i = 0; i < slaveCount; i++) {
    if (slaves[i].connected) {
      if (currentTime - slaves[i].lastUpdate > SLAVE_TIMEOUT) {
        slaves[i].connected = false;
        Serial.print("⚠️ Device ");
        Serial.print(slaves[i].deviceName);
        Serial.println(" disconnected (timeout)");
      }
    }
  }
}

void loadSlaveInfo() {
  slaveCount = preferences.getInt("slaveCount", 0);
  if (slaveCount > MAX_SLAVES) slaveCount = 0;

  for (int i = 0; i < slaveCount; i++) {
    String key = "slave" + String(i);
    size_t len = preferences.getBytes(key.c_str(), &slaves[i], sizeof(SlaveInfo));
    if (len == sizeof(SlaveInfo)) {
      slaves[i].connected = false;
      slaves[i].pairingCount = 0;
      slaves[i].dataCount = 0;
      slaves[i].lastDataReceived = 0;

      esp_now_peer_info_t peerInfo;
      memset(&peerInfo, 0, sizeof(peerInfo));
      memcpy(peerInfo.peer_addr, slaves[i].macAddr, 6);
      peerInfo.channel = 0;
      peerInfo.encrypt = false;
      esp_now_add_peer(&peerInfo);
    }
  }

  if (slaveCount > 0) {
    Serial.print("Loaded ");
    Serial.print(slaveCount);
    Serial.println(" saved devices");
  }
}

void saveSlaveInfo() {
  preferences.putInt("slaveCount", slaveCount);

  for (int i = 0; i < slaveCount; i++) {
    String key = "slave" + String(i);
    preferences.putBytes(key.c_str(), &slaves[i], sizeof(SlaveInfo));
  }

  Serial.println("Slave information saved");
}

void printSlaveStatus() {
  Serial.println("\n========== PAIRED DEVICES STATUS ==========");

  if (slaveCount == 0) {
    Serial.println("No devices paired yet");
    Serial.println("Devices will auto-pair when they send data");
  } else {
    Serial.print("Total paired devices: ");
    Serial.println(slaveCount);
    Serial.println();

    for (int i = 0; i < slaveCount; i++) {
      Serial.print("[");
      Serial.print(i + 1);
      Serial.print("] ");
      Serial.print(slaves[i].deviceName);
      Serial.print(" - MAC: ");

      for (int j = 0; j < 6; j++) {
        Serial.printf("%02X", slaves[i].macAddr[j]);
        if (j < 5) Serial.print(":");
      }

      Serial.print(" - Status: ");
      if (slaves[i].connected) {
        Serial.print("✅ ONLINE");
      } else {
        Serial.print("❌ OFFLINE");
      }

      Serial.println();

      // 상세 정보
      Serial.print("    Pairing count: ");
      Serial.print(slaves[i].pairingCount);
      Serial.print(", Data count: ");
      Serial.println(slaves[i].dataCount);

      if (slaves[i].lastDataReceived > 0) {
        Serial.print("    Last data: ");
        Serial.print((millis() - slaves[i].lastDataReceived) / 1000);
        Serial.println(" sec ago");

        if (slaves[i].connected) {
          Serial.print("    Sensor values - Temp: ");
          Serial.print(slaves[i].lastData.temperature, 1);
          Serial.print("°C, Humidity: ");
          Serial.print(slaves[i].lastData.humidity, 1);
          Serial.print("%, CO2: ");
          Serial.print(slaves[i].lastData.co2);
          Serial.print("ppm, Light: ");
          Serial.print(slaves[i].lastData.lux, 0);
          Serial.println("lux");
        }
      } else {
        Serial.println("    No data received yet");
      }
    }
  }

  Serial.print("\nPairing mode: ");
  Serial.println(pairingMode ? "ENABLED" : "DISABLED");
  Serial.println("==========================================");
}

// ========== 센서 읽기 함수 ==========
void readSensors() {
  voltage = pzem.voltage();
  current = pzem.current();
  power = pzem.power();
  energy = pzem.energy();
  frequency = pzem.frequency();
  pf = pzem.pf();

  if(isnan(voltage)) voltage = 0;
  if(isnan(current)) current = 0;
  if(isnan(power)) power = 0;
  if(isnan(energy)) energy = 0;
  if(isnan(frequency)) frequency = 0;
  if(isnan(pf)) pf = 0;

  motorSpeedValue = analogRead(MOTOR_SPEED_PIN);
  proximityState = !digitalRead(PROXIMITY_PIN);
}

// ========== 출력 함수 ==========
void sendJSON() {
  Serial.print("{");

  Serial.print("\"master\":{");
  Serial.print("\"voltage\":");
  Serial.print(voltage, 2);
  Serial.print(",\"current\":");
  Serial.print(current, 3);
  Serial.print(",\"power\":");
  Serial.print(power, 2);
  Serial.print(",\"energy\":");
  Serial.print(energy, 3);
  Serial.print(",\"frequency\":");
  Serial.print(frequency, 1);
  Serial.print(",\"pf\":");
  Serial.print(pf, 2);
  Serial.print(",\"motor_adc\":");
  Serial.print(motorSpeedValue);
  Serial.print(",\"proximity\":");
  Serial.print(proximityState ? 1 : 0);
  Serial.print("},");

  Serial.print("\"slaves\":[");
  int connectedCount = 0;
  for (int i = 0; i < slaveCount; i++) {
    if (slaves[i].connected) {
      if (connectedCount > 0) Serial.print(",");
      Serial.print("{");
      Serial.print("\"name\":\"");
      Serial.print(slaves[i].deviceName);
      Serial.print("\",\"temperature\":");
      Serial.print(slaves[i].lastData.temperature, 1);
      Serial.print(",\"humidity\":");
      Serial.print(slaves[i].lastData.humidity, 1);
      Serial.print(",\"co2\":");
      Serial.print(slaves[i].lastData.co2);
      Serial.print(",\"lux\":");
      Serial.print(slaves[i].lastData.lux, 0);
      Serial.print("}");
      connectedCount++;
    }
  }
  Serial.print("],");

  Serial.print("\"relays\":[");
  for(int i = 0; i < 16; i++) {
    Serial.print(getRelayState(i) ? 1 : 0);
    if(i < 15) Serial.print(",");
  }
  Serial.print("],");

  Serial.print("\"relay_hex\":\"0x");
  Serial.print(relayStates, HEX);
  Serial.print("\",");

  Serial.print("\"water_running\":");
  Serial.print(autoWatering.running ? 1 : 0);

  Serial.print(",\"drain_running\":");
  Serial.print(autoDrain.running ? 1 : 0);

  Serial.println("}");
}

void printStatus() {
  Serial.println("\n========== MASTER STATUS ==========");

  Serial.println("--- Relay Status ---");
  Serial.print("State: 0x");
  Serial.print(relayStates, HEX);
  Serial.print(" = ");
  for(int i = 15; i >= 0; i--) {
    Serial.print((relayStates >> i) & 0x01);
    if(i == 8) Serial.print(" ");
  }
  Serial.println();

  Serial.println("\n--- Power Monitor ---");
  Serial.print("Voltage: ");
  Serial.print(voltage, 1);
  Serial.print("V, Current: ");
  Serial.print(current, 3);
  Serial.print("A, Power: ");
  Serial.print(power, 1);
  Serial.println("W");

  Serial.println("\n--- Sensors ---");
  Serial.print("Motor Speed ADC: ");
  Serial.println(motorSpeedValue);
  Serial.print("Proximity: ");
  Serial.println(proximityState ? "DETECTED" : "CLEAR");

  Serial.println("====================================");
}

void printHelp() {
  Serial.println("\n========== HELP ==========");

  Serial.println("SLAVE CONTROL:");
  Serial.println("  DEVICES      - Show all paired devices");
  Serial.println("  PAIRING      - Toggle pairing mode");
  Serial.println("  UNPAIR n     - Remove device n");
  Serial.println("  UNPAIR ALL   - Remove all devices");
  Serial.println("  DEBUG        - Toggle debug mode");
  Serial.println("  INFO         - Show debug information");

  Serial.println("\nWATER CONTROL:");
  Serial.println("  WATER:A,B,C  - Set & start (A=delay, B=duration, C=cycles)");
  Serial.println("  WATER START  - Start watering");
  Serial.println("  WATER STOP   - Stop watering");

  Serial.println("\nDRAIN CONTROL:");
  Serial.println("  DRAIN:A,B,C  - Set & start (A=delay, B=duration, C=cycles)");
  Serial.println("  DRAIN START  - Start draining");
  Serial.println("  DRAIN STOP   - Stop draining");

  Serial.println("\nRELAY CONTROL:");
  Serial.println("  Rn:s     - Set relay n to s (R0:1, R15:0)");
  Serial.println("  ON       - All relays on");
  Serial.println("  OFF      - All relays off");
  Serial.println("  TEST     - Quick test");
  Serial.println("  SCAN     - Test each relay");

  Serial.println("\nMONITOR:");
  Serial.println("  STATUS   - Full status");
  Serial.println("  JSON     - JSON output");
  Serial.println("  MONITOR  - Toggle monitoring");

  Serial.println("========================\n");
}

// ========== 시리얼 명령 처리 ==========
void handleSerialCommand() {
  while (Serial.available()) {
    char inChar = (char)Serial.read();
    inputString += inChar;

    if (inChar == '\n') {
      processCommand(inputString);
      inputString = "";
    }
  }
}

void processCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  String cmdUpper = cmd;
  cmdUpper.toUpperCase();

  // 슬레이브 관련 명령
  if (cmdUpper == "SLAVES" || cmdUpper == "DEVICES") {
    printSlaveStatus();
  }
  else if (cmdUpper == "INFO") {
    printDebugInfo();
  }
  else if (cmdUpper == "PAIRING ON") {
    pairingMode = true;
    Serial.println("Pairing mode: ENABLED");
  }
  else if (cmdUpper == "PAIRING OFF") {
    pairingMode = false;
    Serial.println("Pairing mode: DISABLED");
  }
  else if (cmdUpper == "PAIRING") {
    pairingMode = !pairingMode;
    Serial.print("Pairing mode: ");
    Serial.println(pairingMode ? "ENABLED" : "DISABLED");
  }
  else if (cmdUpper == "CLEAR SLAVES" || cmdUpper == "UNPAIR ALL") {
    for (int i = 0; i < slaveCount; i++) {
      esp_now_del_peer(slaves[i].macAddr);
    }
    slaveCount = 0;
    saveSlaveInfo();
    Serial.println("All devices unpaired");
  }
  else if (cmdUpper.startsWith("UNPAIR ")) {
    int index = cmdUpper.substring(7).toInt() - 1;
    if (index >= 0 && index < slaveCount) {
      esp_now_del_peer(slaves[index].macAddr);

      for (int i = index; i < slaveCount - 1; i++) {
        slaves[i] = slaves[i + 1];
      }
      slaveCount--;
      saveSlaveInfo();

      Serial.print("Device ");
      Serial.print(index + 1);
      Serial.println(" unpaired");
    } else {
      Serial.println("Invalid device number");
    }
  }
  else if (cmdUpper == "SAVE SLAVES") {
    saveSlaveInfo();
  }
  // 자동 급수 관련 명령
  else if (cmdUpper.startsWith("WATER:")) {
    String params = cmdUpper.substring(6);
    int comma1 = params.indexOf(',');
    int comma2 = params.indexOf(',', comma1 + 1);

    if (comma1 > 0 && comma2 > comma1) {
      uint32_t a = params.substring(0, comma1).toInt();
      uint32_t b = params.substring(comma1 + 1, comma2).toInt();
      uint16_t c = params.substring(comma2 + 1).toInt();

      if (a > 0 && b > 0 && c > 0) {
        autoWatering.delayA = a;
        autoWatering.durationB = b;
        autoWatering.cycleCount = c;
        saveAutoWateringConfig();

        Serial.print("OK:WATER Config set - Delay=");
        Serial.print(a);
        Serial.print("s, Duration=");
        Serial.print(b);
        Serial.print("s, Cycles=");
        Serial.println(c);

        startAutoWatering();
      } else {
        Serial.println("Error: Invalid parameters");
      }
    } else {
      Serial.println("Error: Use WATER:A,B,C format");
    }
  }
  else if (cmdUpper == "WATER START" || cmdUpper == "WATER") {
    startAutoWatering();
  }
  else if (cmdUpper == "WATER STOP") {
    stopAutoWatering();
  }
  else if (cmdUpper == "WATER STATUS") {
    printWaterStatus();
  }
  // 자동 배수 관련 명령
  else if (cmdUpper.startsWith("DRAIN:")) {
    String params = cmdUpper.substring(6);
    int comma1 = params.indexOf(',');
    int comma2 = params.indexOf(',', comma1 + 1);

    if (comma1 > 0 && comma2 > comma1) {
      uint32_t a = params.substring(0, comma1).toInt();
      uint32_t b = params.substring(comma1 + 1, comma2).toInt();
      uint16_t c = params.substring(comma2 + 1).toInt();

      if (a > 0 && b > 0 && c > 0) {
        autoDrain.delayA = a;
        autoDrain.durationB = b;
        autoDrain.cycleCount = c;
        saveAutoDrainConfig();

        Serial.print("OK:DRAIN Config set - Delay=");
        Serial.print(a);
        Serial.print("s, Duration=");
        Serial.print(b);
        Serial.print("s, Cycles=");
        Serial.println(c);

        startAutoDrain();
      } else {
        Serial.println("Error: Invalid parameters");
      }
    } else {
      Serial.println("Error: Use DRAIN:A,B,C format");
    }
  }
  else if (cmdUpper == "DRAIN START" || cmdUpper == "DRAIN") {
    startAutoDrain();
  }
  else if (cmdUpper == "DRAIN STOP") {
    stopAutoDrain();
  }
  else if (cmdUpper == "DRAIN STATUS") {
    printDrainStatus();
  }
  // 릴레이 관련 명령
  else if (cmdUpper.startsWith("R") && cmdUpper.length() > 2) {
    int colonIndex = cmdUpper.indexOf(':');
    if (colonIndex > 1) {
      String numStr = cmdUpper.substring(1, colonIndex);
      int relayNum = numStr.toInt();
      int state = cmdUpper.substring(colonIndex + 1).toInt();

      if (numStr == String(relayNum)) {
        setRelay(relayNum, state);
        Serial.print("OK:R");
        Serial.print(relayNum);
        Serial.print(":");
        Serial.println(state);
      } else {
        Serial.println("Error: Invalid relay number");
      }
    }
  }
  else if (cmdUpper == "ON") {
    setAllRelays(true);
    Serial.println("OK:ALL_ON");
  }
  else if (cmdUpper == "OFF") {
    setAllRelays(false);
    Serial.println("OK:ALL_OFF");
  }
  else if (cmdUpper == "TEST") {
    quickTest();
  }
  else if (cmdUpper == "SCAN") {
    scanRelays();
  }
  // 상태 및 모니터링
  else if (cmdUpper == "STATUS" || cmdUpper == "S") {
    printStatus();
    printSlaveStatus();
  }
  else if (cmdUpper == "JSON") {
    sendJSON();
  }
  else if (cmdUpper == "SAVE") {
    saveRelayStates(true);
    Serial.println("OK:SAVED");
  }
  else if (cmdUpper == "LOAD") {
    loadRelayStates();
    updateShiftRegisters();
    Serial.println("OK:LOADED");
  }
  else if (cmdUpper.startsWith("MONITOR:")) {
    int interval = cmdUpper.substring(8).toInt();
    if (interval > 0) {
      monitorMode = true;
      monitorInterval = interval;
      Serial.print("OK:Monitor ON (");
      Serial.print(interval);
      Serial.println("ms)");
    } else {
      monitorMode = false;
      Serial.println("OK:Monitor OFF");
    }
  }
  else if (cmdUpper == "MONITOR") {
    monitorMode = !monitorMode;
    Serial.print("OK:Monitor ");
    Serial.println(monitorMode ? "ON" : "OFF");
  }
  else if (cmdUpper == "DEBUG") {
    debugMode = !debugMode;
    Serial.print("Debug mode: ");
    Serial.println(debugMode ? "ON" : "OFF");
  }
  else if (cmdUpper == "HELP" || cmdUpper == "?") {
    printHelp();
  }
  else {
    Serial.println("Unknown command. Type HELP");
  }
}


