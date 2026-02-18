#include <WiFi.h>
#include <esp_now.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <TFT_eSPI.h>
#include <Wire.h>
#include <Adafruit_SCD30.h>
#include <Adafruit_TSL2591.h>

// ========== 슬레이브 번호에 따라 변경 ==========
// 슬레이브 1: "실내센서1"
// 슬레이브 2: "실내센서2" 
// 슬레이브 3: "실내센서3"
const char* SLAVE_NAME = "실내센서2";  

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

// 브로드캐스트 주소
uint8_t broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
uint8_t masterAddress[6] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
bool masterPaired = false;
unsigned long lastPairingAttempt = 0;
const unsigned long PAIRING_INTERVAL = 5000;

SensorData sensorData;

// 센서 객체들
TFT_eSPI tft = TFT_eSPI();
Adafruit_SCD30 scd30;
Adafruit_TSL2591 tsl = Adafruit_TSL2591(2591);

// 센서 상태
bool scd30_initialized = false;
bool tsl_initialized = false;

// Preferences
Preferences preferences;

// 전역 변수
String deviceName = SLAVE_NAME;
unsigned long lastSendTime = 0;
const unsigned long sendInterval = 10000;  // 10초마다 데이터 전송
bool espNowInitialized = false;

// 디버깅 변수
unsigned long totalDataSent = 0;
unsigned long totalPairingRequests = 0;
unsigned long lastDebugPrint = 0;
bool debugMode = true;

// 광센서 변화량 감지 관련 변수
float previousLux = 0;
float initialLux = 0;
bool coverDetected = false;
int lowLightCount = 0;
unsigned long lastResetCheck = 0;
bool resetInProgress = false;
const float LUX_DROP_THRESHOLD = 0.8;
const int RESET_SECONDS = 5;

// 센서 실패 카운트
unsigned long sensorFailCount = 0;

// ESP-NOW 콜백 함수
void OnDataSent(const esp_now_send_info_t *send_info, esp_now_send_status_t status) {
  if (status == ESP_NOW_SEND_SUCCESS) {
    tft.fillRect(200, 0, 40, 12, TFT_BLACK);
    tft.setTextSize(1);
    tft.setCursor(200, 0);
    tft.setTextColor(TFT_GREEN);
    tft.print("TX OK");
    
    if (debugMode) {
      Serial.println("[DEBUG] Data sent successfully");
    }
  } else {
    tft.fillRect(200, 0, 40, 12, TFT_BLACK);
    tft.setTextSize(1);
    tft.setCursor(200, 0);
    tft.setTextColor(TFT_RED);
    tft.print("TX FAIL");
    
    if (debugMode) {
      Serial.println("[DEBUG] Data send failed!");
    }
    
    // 전송 실패시 페어링 상태 재확인
    static int failCount = 0;
    failCount++;
    if (failCount > 5 && masterPaired) {
      Serial.println("Too many send failures, will re-pair");
      masterPaired = false;
      failCount = 0;
    }
  }
}

void OnDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *data, int data_len) {
  const uint8_t *mac_addr = recv_info->src_addr;
  
  if (data_len < 1) return;
  
  uint8_t msgType = data[0];
  
  if (debugMode) {
    Serial.print("[DEBUG] Received message type ");
    Serial.print(msgType);
    Serial.print(" from ");
    for (int i = 0; i < 6; i++) {
      Serial.printf("%02X", mac_addr[i]);
      if (i < 5) Serial.print(":");
    }
    Serial.println();
  }
  
  if (msgType == MSG_PAIRING_RESPONSE) {
    if (data_len != sizeof(PairingMessage)) return;
    
    PairingMessage response;
    memcpy(&response, data, sizeof(response));
    
    memcpy(masterAddress, mac_addr, 6);
    masterPaired = true;
    
    // 마스터 주소 저장
    preferences.begin("slave-config", false);
    preferences.putBytes("masterMAC", masterAddress, 6);
    preferences.putBool("paired", true);
    preferences.end();
    
    Serial.print("✅ Paired with master: ");
    for (int i = 0; i < 6; i++) {
      Serial.printf("%02X", masterAddress[i]);
      if (i < 5) Serial.print(":");
    }
    Serial.println();
    
    // 피어 업데이트
    esp_now_peer_info_t peerInfo;
    memset(&peerInfo, 0, sizeof(peerInfo));
    memcpy(peerInfo.peer_addr, masterAddress, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = false;
    
    // 브로드캐스트 피어 제거하고 마스터 피어 추가
    esp_now_del_peer(broadcastAddress);
    
    if (esp_now_is_peer_exist(masterAddress)) {
      esp_now_del_peer(masterAddress);
    }
    
    if (esp_now_add_peer(&peerInfo) == ESP_OK) {
      Serial.println("Master peer added successfully");
    } else {
      Serial.println("Failed to add master peer!");
    }
    
    // LCD 업데이트
    tft.fillRect(0, 145, 240, 15, TFT_BLACK);
    tft.setTextSize(1);
    tft.setTextColor(TFT_GREEN);
    tft.setCursor(5, 147);
    tft.print("Paired with master!");
    
    // 페어링 직후 첫 데이터 전송
    delay(1000);
    sendSensorData();
  }
}

void initDisplay() {
  pinMode(23, OUTPUT);
  digitalWrite(23, HIGH);
  delay(5);
  digitalWrite(23, LOW);
  delay(20);
  digitalWrite(23, HIGH);
  delay(150);
}

float calculateLux(uint16_t full, uint16_t ir) {
  return (full - ir) * 0.5;
}

float getCurrentLux() {
  if (!tsl_initialized) {
    return -999;  // 센서 오류
  }
  
  uint32_t lum = tsl.getFullLuminosity();
  uint16_t ir = lum >> 16;
  uint16_t full = lum & 0xFFFF;
  return calculateLux(full, ir);
}

void loadConfig() {
  preferences.begin("slave-config", false);
  masterPaired = preferences.getBool("paired", false);
  
  if (masterPaired) {
    size_t macLen = preferences.getBytes("masterMAC", masterAddress, 6);
    if (macLen != 6) {
      masterPaired = false;
      Serial.println("Invalid stored MAC address, will re-pair");
    }
  }
  
  preferences.end();
  
  Serial.print("Device Name: ");
  Serial.println(deviceName);
  
  if (masterPaired) {
    Serial.print("Previously paired with: ");
    for (int i = 0; i < 6; i++) {
      Serial.printf("%02X", masterAddress[i]);
      if (i < 5) Serial.print(":");
    }
    Serial.println();
  } else {
    Serial.println("Not paired yet - will auto-pair");
  }
}

void initESPNow() {
  WiFi.mode(WIFI_STA);
  
  Serial.print("Slave MAC Address: ");
  Serial.println(WiFi.macAddress());
  
  WiFi.macAddress(sensorData.macAddr);
  
  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    espNowInitialized = false;
    return;
  }
  
  espNowInitialized = true;
  
  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);
  
  esp_now_peer_info_t peerInfo;
  memset(&peerInfo, 0, sizeof(peerInfo));
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  
  if (masterPaired) {
    memcpy(peerInfo.peer_addr, masterAddress, 6);
    if (esp_now_add_peer(&peerInfo) == ESP_OK) {
      Serial.println("Using saved master address");
    } else {
      Serial.println("Failed to add master peer!");
      masterPaired = false;
    }
  }
  
  // 항상 브로드캐스트 피어도 추가 (페어링용)
  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  esp_now_add_peer(&peerInfo);
  
  Serial.println("ESP-NOW initialized successfully");
  Serial.print("Data structure size: ");
  Serial.print(sizeof(SensorData));
  Serial.println(" bytes");
}

void sendPairingRequest() {
  if (!espNowInitialized) {
    Serial.println("[ERROR] ESP-NOW not initialized");
    return;
  }
  
  totalPairingRequests++;
  
  PairingMessage pairMsg;
  pairMsg.msgType = MSG_PAIRING_REQUEST;
  strcpy(pairMsg.deviceName, deviceName.c_str());
  WiFi.macAddress(pairMsg.macAddr);
  
  Serial.print("Sending pairing request #");
  Serial.print(totalPairingRequests);
  Serial.print("... ");
  
  esp_err_t result = esp_now_send(broadcastAddress, (uint8_t*)&pairMsg, sizeof(pairMsg));
  
  if (result == ESP_OK) {
    Serial.println("OK");
    
    tft.fillRect(0, 145, 240, 15, TFT_BLACK);
    tft.setTextSize(1);
    tft.setTextColor(TFT_YELLOW);
    tft.setCursor(5, 147);
    tft.print("Pairing request #");
    tft.print(totalPairingRequests);
  } else {
    Serial.print("FAILED (error: ");
    Serial.print(result);
    Serial.println(")");
  }
}

void sendSensorData() {
  if (!espNowInitialized) {
    Serial.println("[ERROR] ESP-NOW not initialized");
    return;
  }
  
  // 센서가 준비되지 않았으면 전송하지 않음
  if (!scd30_initialized) {
    Serial.println("[SKIP] SCD30 not initialized - no data to send");
    return;
  }
  
  // 센서 데이터가 준비되지 않았으면 전송하지 않음
  if (!scd30.dataReady()) {
    Serial.println("[SKIP] Sensor data not ready");
    return;
  }
  
  // 센서 데이터 읽기
  if (!scd30.read()) {
    Serial.println("[ERROR] Failed to read sensor data");
    sensorFailCount++;
    return;
  }
  
  // 전송 대상 설정 (마스터가 있으면 마스터로, 없으면 브로드캐스트로)
  uint8_t* targetAddress = masterPaired ? masterAddress : broadcastAddress;
  
  // 센서 데이터 준비
  sensorData.msgType = MSG_SENSOR_DATA;
  strcpy(sensorData.deviceName, deviceName.c_str());
  sensorData.timestamp = millis();
  WiFi.macAddress(sensorData.macAddr);  // 자신의 MAC 주소 포함
  
  // 실제 센서 데이터만 사용
  sensorData.temperature = scd30.temperature;
  sensorData.humidity = scd30.relative_humidity;
  sensorData.co2 = scd30.CO2;
  
  // 조도 센서
  if (tsl_initialized) {
    sensorData.lux = getCurrentLux();
  } else {
    sensorData.lux = 0;  // 센서 없으면 0
  }
  
  totalDataSent++;
  
  // 데이터 전송
  Serial.print("📤 Sending data #");
  Serial.print(totalDataSent);
  Serial.print(" to ");
  Serial.print(masterPaired ? "master" : "broadcast");
  Serial.print(" - Temp:");
  Serial.print(sensorData.temperature, 1);
  Serial.print("°C, Hum:");
  Serial.print(sensorData.humidity, 1);
  Serial.print("%, CO2:");
  Serial.print(sensorData.co2);
  Serial.print("ppm... ");
  
  esp_err_t result = esp_now_send(targetAddress, (uint8_t*)&sensorData, sizeof(sensorData));
  
  if (result == ESP_OK) {
    Serial.println("SUCCESS");
    lastSendTime = millis();
    
    // 브로드캐스트로 성공했으면 페어링 대기
    if (!masterPaired) {
      Serial.println("Waiting for master response...");
    }
  } else {
    Serial.print("FAILED (error: ");
    Serial.print(result);
    Serial.println(")");
    
    // 전송 실패 카운트
    static int consecutiveFailures = 0;
    consecutiveFailures++;
    
    if (consecutiveFailures > 10 && masterPaired) {
      Serial.println("Too many failures, switching to broadcast");
      masterPaired = false;
      consecutiveFailures = 0;
    }
  }
}

void checkSensorReset() {
  if (millis() - lastResetCheck < 1000) {
    return;
  }
  lastResetCheck = millis();
  
  float lux = getCurrentLux();
  
  if (previousLux == 0) {
    previousLux = lux;
    initialLux = lux;
    return;
  }
  
  if (!coverDetected && previousLux > 10) {
    if (lux < previousLux * (1 - LUX_DROP_THRESHOLD)) {
      coverDetected = true;
      initialLux = previousLux;
      Serial.println("Light sensor covered - reset pairing in 5 sec");
    }
  }
  
  if (coverDetected && lux < initialLux * (1 - LUX_DROP_THRESHOLD)) {
    lowLightCount++;
    resetInProgress = true;
    
    if (lowLightCount < RESET_SECONDS) {
      tft.fillRect(0, 145, 240, 15, TFT_BLACK);
      tft.setTextSize(1);
      tft.setTextColor(TFT_YELLOW);
      tft.setCursor(5, 147);
      tft.print("Reset pairing in: ");
      tft.print(RESET_SECONDS - lowLightCount);
      tft.print(" sec");
    }
    
    if (lowLightCount >= RESET_SECONDS) {
      masterPaired = false;
      memset(masterAddress, 0, 6);
      
      preferences.begin("slave-config", false);
      preferences.putBool("paired", false);
      preferences.end();
      
      esp_now_deinit();
      initESPNow();
      
      Serial.println("Pairing reset - will auto-pair again");
      
      tft.fillRect(0, 145, 240, 15, TFT_BLACK);
      tft.setTextColor(TFT_RED);
      tft.setCursor(5, 147);
      tft.print("Pairing reset!");
      delay(2000);
      
      coverDetected = false;
      lowLightCount = 0;
      resetInProgress = false;
    }
  } else {
    if (coverDetected && lux > initialLux * 0.5) {
      if (resetInProgress && lowLightCount < RESET_SECONDS) {
        tft.fillRect(0, 145, 240, 15, TFT_BLACK);
      }
      coverDetected = false;
      lowLightCount = 0;
      resetInProgress = false;
    }
  }
  
  previousLux = lux;
}

void printDebugInfo() {
  Serial.println("\n========== DEBUG INFO ==========");
  Serial.print("Device: ");
  Serial.println(deviceName);
  Serial.print("MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.print("Master paired: ");
  Serial.println(masterPaired ? "YES" : "NO");
  
  if (masterPaired) {
    Serial.print("Master MAC: ");
    for (int i = 0; i < 6; i++) {
      Serial.printf("%02X", masterAddress[i]);
      if (i < 5) Serial.print(":");
    }
    Serial.println();
  }
  
  Serial.print("Total pairing requests: ");
  Serial.println(totalPairingRequests);
  Serial.print("Total data sent: ");
  Serial.println(totalDataSent);
  Serial.print("Sensor fail count: ");
  Serial.println(sensorFailCount);
  Serial.print("Last data send: ");
  Serial.print((millis() - lastSendTime) / 1000);
  Serial.println(" sec ago");
  
  Serial.print("SCD30 status: ");
  Serial.println(scd30_initialized ? "OK" : "FAILED");
  Serial.print("TSL2591 status: ");
  Serial.println(tsl_initialized ? "OK" : "FAILED");
  
  Serial.println("================================");
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n================================");
  Serial.println("ESP32 Sensor Slave - Enhanced");
  Serial.print("Device Name: ");
  Serial.println(SLAVE_NAME);
  Serial.println("ESP-NOW Auto-Pairing Mode");
  Serial.println("================================\n");
  
  Wire.begin(21, 22);
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH);
  
  initDisplay();
  tft.init();
  tft.setRotation(1);
  
  loadConfig();
  initESPNow();
  
  Serial.println("\nInitializing sensors...");
  
  // SCD30 초기화 (재시도 로직)
  int retries = 5;
  while (retries-- > 0 && !scd30_initialized) {
    if (scd30.begin()) {
      Serial.println("✅ SCD30 sensor initialized");
      scd30_initialized = true;
      scd30.setMeasurementInterval(2);  // 2초 간격 측정
      break;
    } else {
      Serial.print("❌ SCD30 init failed, retries left: ");
      Serial.println(retries);
      delay(1000);
    }
  }
  
  if (!scd30_initialized) {
    Serial.println("⚠️ SCD30 FAILED - No data will be sent");
    tft.setTextColor(TFT_RED);
    tft.setCursor(10, 100);
    tft.println("SCD30 Error!");
  }
  
  // TSL2591 초기화
  retries = 5;
  while (retries-- > 0 && !tsl_initialized) {
    if (tsl.begin()) {
      Serial.println("✅ TSL2591 sensor initialized");
      tsl_initialized = true;
      tsl.setGain(TSL2591_GAIN_MED);
      tsl.setTiming(TSL2591_INTEGRATIONTIME_300MS);
      break;
    } else {
      Serial.print("❌ TSL2591 init failed, retries left: ");
      Serial.println(retries);
      delay(1000);
    }
  }
  
  if (!tsl_initialized) {
    Serial.println("⚠️ TSL2591 FAILED - Lux will be 0");
    tft.setTextColor(TFT_RED);
    tft.setCursor(10, 115);
    tft.println("TSL2591 Error!");
  }
  
  // 초기 화면 표시
  tft.fillScreen(TFT_BLACK);
  tft.setTextSize(2);
  tft.setTextColor(TFT_WHITE);
  tft.setCursor(10, 10);
  tft.println("ESP-NOW Slave");
  tft.setTextSize(1);
  tft.setCursor(10, 35);
  tft.print("Name: ");
  tft.setTextColor(TFT_CYAN);
  tft.println(deviceName);
  tft.setTextColor(TFT_WHITE);
  tft.setCursor(10, 50);
  tft.print("MAC: ");
  tft.println(WiFi.macAddress());
  
  tft.setCursor(10, 80);
  tft.setTextColor(TFT_YELLOW);
  tft.println("Waiting for master...");
  
  delay(2000);
  
  Serial.println("\n=== System Ready ===");
  if (!masterPaired) {
    Serial.println("Will auto-pair with master when detected");
  } else {
    Serial.println("Using previously paired master");
  }
  Serial.println("Cover light sensor for 5 seconds to reset pairing");
  Serial.println("Debug mode: ON");
}

void loop() {
  // 센서 리셋 체크
  if (tsl_initialized) {
    checkSensorReset();
  }
  
  // 디버그 정보 출력
  if (debugMode && millis() - lastDebugPrint > 30000) {  // 30초마다
    lastDebugPrint = millis();
    printDebugInfo();
  }
  
  // 센서 데이터 읽기 및 표시
  bool dataReady = false;
  float temp = 0, hum = 0, lux = 0;
  int co2 = 0;
  
  // SCD30에서 데이터 읽기
  if (scd30_initialized && scd30.dataReady() && scd30.read()) {
    temp = scd30.temperature;
    hum = scd30.relative_humidity;
    co2 = scd30.CO2;
    dataReady = true;
  }
  
  // 조도 센서
  if (tsl_initialized) {
    lux = getCurrentLux();
  } else {
    lux = 0;
  }
  
  // 데이터가 준비되면 화면 업데이트 및 전송
  if (dataReady) {
    // 센서 데이터 업데이트
    sensorData.temperature = temp;
    sensorData.humidity = hum;
    sensorData.co2 = co2;
    sensorData.lux = lux;
    
    // 리셋 진행 중이 아닐 때만 화면 업데이트
    if (!resetInProgress) {
      tft.fillScreen(TFT_BLACK);
      
      // 기기 이름 표시
      tft.setTextSize(1);
      tft.setCursor(5, 0);
      tft.setTextColor(TFT_CYAN);
      tft.print(deviceName);
      
      // 연결 상태
      tft.setCursor(160, 0);
      if (masterPaired) {
        tft.setTextColor(TFT_GREEN);
        tft.print("PAIRED");
      } else {
        tft.setTextColor(TFT_YELLOW);
        tft.print("PAIRING...");
      }
      
      // 센서 데이터 표시
      tft.setTextSize(3);
      
      // 조도
      tft.setTextColor(TFT_YELLOW);
      tft.setCursor(5, 20);
      tft.print("L:");
      if(lux < 1000) {
        tft.print((int)lux);
        tft.print("lux");
      } else {
        tft.print(lux/1000, 1);
        tft.print("K");
      }
      
      // CO2
      if(co2 > 1000) tft.setTextColor(TFT_RED);
      else if(co2 > 800) tft.setTextColor(TFT_YELLOW);
      else tft.setTextColor(TFT_GREEN);
      tft.setCursor(5, 53);
      tft.print("CO2:");
      tft.print(co2);
      tft.print("ppm");
      
      // 온도
      tft.setTextColor(TFT_CYAN);
      tft.setCursor(5, 86);
      tft.print("T:");
      tft.print(temp, 1);
      tft.print("C");
      
      // 습도
      tft.setTextColor(TFT_BLUE);
      tft.setCursor(5, 119);
      tft.print("H:");
      tft.print((int)hum);
      tft.print("%");
      
      // 하단 정보
      tft.setTextSize(1);
      tft.setTextColor(TFT_WHITE);
      tft.setCursor(5, 147);
      if (!masterPaired) {
        tft.setTextColor(TFT_YELLOW);
        tft.print("Searching for master...");
      } else {
        tft.print("Data #");
        tft.print(totalDataSent);
        tft.print(" | Next: ");
        tft.print((sendInterval - (millis() - lastSendTime)) / 1000);
        tft.print("s");
      }
    }
    
    // 데이터 전송 (10초마다)
    unsigned long currentTime = millis();
    if (currentTime - lastSendTime >= sendInterval) {
      sendSensorData();
    }
  } else if (!scd30_initialized) {
    // SCD30이 초기화되지 않았을 때 에러 메시지 표시
    static unsigned long lastErrorDisplay = 0;
    if (millis() - lastErrorDisplay > 5000) {
      lastErrorDisplay = millis();
      
      tft.fillScreen(TFT_BLACK);
      tft.setTextSize(2);
      tft.setTextColor(TFT_RED);
      tft.setCursor(10, 50);
      tft.println("SCD30 ERROR!");
      tft.setTextSize(1);
      tft.setCursor(10, 80);
      tft.println("No sensor data available");
      tft.setCursor(10, 100);
      tft.println("Check sensor connection");
    }
  } else {
    // 센서는 초기화됐지만 데이터가 아직 준비 안 됨
    if (!resetInProgress) {
      tft.fillRect(0, 145, 240, 15, TFT_BLACK);
      tft.setTextSize(1);
      tft.setTextColor(TFT_YELLOW);
      tft.setCursor(5, 147);
      tft.print("Waiting for sensor data...");
    }
  }
  
  delay(2000);
}
