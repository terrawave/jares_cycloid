#include <HardwareSerial.h>
#include <PZEM004Tv30.h>
#include <Preferences.h>
#include <esp_now.h>
#include <WiFi.h>
#include <ArduinoJson.h>

// Preferences ê°ì²´
Preferences preferences;

// PZEM-004T V3.0 ëª¨ë“ˆìš© í†µì‹  ì„¤ì •
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17
#define PZEM_SERIAL Serial2
PZEM004Tv30 pzem(PZEM_SERIAL, PZEM_RX_PIN, PZEM_TX_PIN);

// 74HC595 ì‹œí”„íŠ¸ ë ˆì§€ìŠ¤í„° ì œì–´ í•€
const int dataPin = 14;
const int latchPin = 12;
const int clockPin = 13;
const int oePin = 5;

// ì„¼ì„œ í•€ ì •ì˜
#define MOTOR_SPEED_PIN 34
#define PROXIMITY_PIN 18

// ë¦´ë ˆì´ ìƒíƒœ ì €ìž¥
uint16_t relayStates = 0x0000;
uint16_t lastSavedRelayStates = 0x0000;
uint32_t saveCount = 0;

// ========== ESP-NOW êµ¬ì¡°ì²´ ==========
// ë©”ì‹œì§€ íƒ€ìž…
enum MessageType {
  MSG_SENSOR_DATA = 1,
  MSG_PAIRING_REQUEST = 2,
  MSG_PAIRING_RESPONSE = 3,
  MSG_COMMAND = 4
};

// íŽ˜ì–´ë§ ë©”ì‹œì§€ êµ¬ì¡°ì²´
typedef struct {
  uint8_t msgType;
  char deviceName[32];
  uint8_t macAddr[6];
} PairingMessage;

// ì„¼ì„œ ë°ì´í„° êµ¬ì¡°ì²´
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

// ìŠ¬ë ˆì´ë¸Œ ì •ë³´ êµ¬ì¡°ì²´
typedef struct {
  char deviceName[32];
  uint8_t macAddr[6];
  bool paired;
  bool connected;
  unsigned long lastUpdate;
  unsigned long lastDataReceived;  // ì‹¤ì œ ë°ì´í„° ìˆ˜ì‹  ì‹œê°„
  unsigned long pairingCount;      // íŽ˜ì–´ë§ íšŸìˆ˜
  unsigned long dataCount;         // ë°ì´í„° ìˆ˜ì‹  íšŸìˆ˜
  SensorData lastData;
} SlaveInfo;

// ìŠ¬ë ˆì´ë¸Œ ê´€ë¦¬
#define MAX_SLAVES 10
SlaveInfo slaves[MAX_SLAVES];
int slaveCount = 0;
const unsigned long SLAVE_TIMEOUT = 60000;

// ë¸Œë¡œë“œìºìŠ¤íŠ¸ ì£¼ì†Œ
uint8_t broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ========== ìžë™ ê¸‰ìˆ˜ ì‹œìŠ¤í…œ ë³€ìˆ˜ ==========
#define RELAY_MOTOR_FORWARD 8
#define RELAY_MOTOR_SPEED1 0
#define RELAY_WATER_VALVE 4

struct AutoWateringConfig {
  uint32_t delayA;
  uint32_t durationB;
  uint16_t cycleCount;
  bool enabled;
  bool running;
  uint16_t currentCycle;
  
  enum State {
    IDLE,
    WAIT_CLEAR,      // 센서가 clear(감지 안됨) 상태 대기
    WAIT_SENSOR,     // 센서가 감지됨 상태 대기
    DELAY_A,
    WATERING,
    CYCLE_COMPLETE
  } state;
  
  unsigned long stateStartTime;
  bool sensorDetected;
  unsigned long lastSensorClearTime;   // 센서가 clear된 시간
  unsigned long sensorDetectedTime;    // 센서가 감지된 시간
} autoWatering;

// ê¸°íƒ€ ë³€ìˆ˜ë“¤
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

// ë””ë²„ê¹…ìš© ë³€ìˆ˜ ì¶”ê°€
unsigned long totalMessagesReceived = 0;
unsigned long lastDebugOutput = 0;

// ========== í•¨ìˆ˜ ì„ ì–¸ (Forward Declaration) ==========
void loadSlaveInfo();
void saveSlaveInfo();
void loadAutoWateringConfig();
void saveAutoWateringConfig();
void startAutoWatering();
void stopAutoWatering();
void processAutoWatering();
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
void printSlaveStatus();
void printStatus();
void printHelp();
void sendJSON();
void checkSlaveConnections();
void processCommand(String cmd);
void printDebugInfo();

// ========== ESP-NOW ì½œë°± í•¨ìˆ˜ ==========
void OnDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *data, int data_len) {
  const uint8_t *mac_addr = recv_info->src_addr;
  totalMessagesReceived++;
  
  if (data_len < 1) return;
  
  uint8_t msgType = data[0];
  
  // ë””ë²„ê¹…: ëª¨ë“  ìˆ˜ì‹  ë©”ì‹œì§€ ë¡œê·¸
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
      
      // ê¸°ì¡´ ìž¥ì¹˜ì¸ì§€ í™•ì¸ (ì´ë¦„ìœ¼ë¡œ)
      int existingIndex = -1;
      for (int i = 0; i < slaveCount; i++) {
        if (strcmp(slaves[i].deviceName, pairMsg.deviceName) == 0) {
          existingIndex = i;
          break;
        }
      }
      
      if (existingIndex >= 0) {
        // MAC ì£¼ì†Œ ì—…ë°ì´íŠ¸
        memcpy(slaves[existingIndex].macAddr, mac_addr, 6);
        slaves[existingIndex].paired = true;
        slaves[existingIndex].connected = true;
        slaves[existingIndex].lastUpdate = millis();
        slaves[existingIndex].pairingCount++;
        
        if (debugMode) {
          Serial.print("â™»ï¸ Re-paired: ");
          Serial.print(pairMsg.deviceName);
          Serial.print(" (count: ");
          Serial.print(slaves[existingIndex].pairingCount);
          Serial.println(")");
        }
      } else if (slaveCount < MAX_SLAVES) {
        // ìƒˆ ìž¥ì¹˜ ì¶”ê°€
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
        
        Serial.print("âœ… New device paired: ");
        Serial.print(pairMsg.deviceName);
        Serial.print(" [");
        for (int i = 0; i < 6; i++) {
          Serial.printf("%02X", mac_addr[i]);
          if (i < 5) Serial.print(":");
        }
        Serial.println("]");
      }
      
      // íŽ˜ì–´ë§ ì‘ë‹µ ì „ì†¡
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
      
      // í•´ë‹¹ ìŠ¬ë ˆì´ë¸Œ ì°¾ê¸° (MAC ì£¼ì†Œë¡œ)
      int deviceIndex = -1;
      for (int i = 0; i < slaveCount; i++) {
        if (memcmp(slaves[i].macAddr, mac_addr, 6) == 0) {
          deviceIndex = i;
          break;
        }
      }
      
      // ëª» ì°¾ìœ¼ë©´ ìž¥ì¹˜ ì´ë¦„ìœ¼ë¡œ ì°¾ê¸°
      if (deviceIndex == -1) {
        for (int i = 0; i < slaveCount; i++) {
          if (strcmp(slaves[i].deviceName, receivedData.deviceName) == 0) {
            // MAC ì£¼ì†Œ ì—…ë°ì´íŠ¸
            memcpy(slaves[i].macAddr, mac_addr, 6);
            deviceIndex = i;
            Serial.print("ðŸ“ Updated MAC for ");
            Serial.println(receivedData.deviceName);
            break;
          }
        }
      }
      
      // ê·¸ëž˜ë„ ëª» ì°¾ìœ¼ë©´ ìžë™ íŽ˜ì–´ë§ (ìƒˆ ìž¥ì¹˜)
      if (deviceIndex == -1 && slaveCount < MAX_SLAVES) {
        // ìƒˆ ìŠ¬ë ˆì´ë¸Œ ìžë™ ì¶”ê°€
        strcpy(slaves[slaveCount].deviceName, receivedData.deviceName);
        memcpy(slaves[slaveCount].macAddr, mac_addr, 6);
        slaves[slaveCount].paired = true;
        slaves[slaveCount].connected = true;
        slaves[slaveCount].lastUpdate = millis();
        slaves[slaveCount].lastDataReceived = millis();
        slaves[slaveCount].pairingCount = 0;
        slaves[slaveCount].dataCount = 1;
        slaves[slaveCount].lastData = receivedData;
        
        // ESP-NOW í”¼ì–´ ì¶”ê°€
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
        
        Serial.print("ðŸ†• Auto-paired new device: ");
        Serial.print(receivedData.deviceName);
        Serial.print(" [");
        for (int i = 0; i < 6; i++) {
          Serial.printf("%02X", mac_addr[i]);
          if (i < 5) Serial.print(":");
        }
        Serial.println("]");
        
        // íŽ˜ì–´ë§ ì‘ë‹µ ì „ì†¡
        PairingMessage response;
        response.msgType = MSG_PAIRING_RESPONSE;
        strcpy(response.deviceName, "MASTER");
        WiFi.macAddress(response.macAddr);
        esp_now_send(mac_addr, (uint8_t*)&response, sizeof(response));
      }
      
      // ë°ì´í„° ì €ìž¥ ë° ì¶œë ¥
      if (deviceIndex >= 0) {
        slaves[deviceIndex].lastData = receivedData;
        slaves[deviceIndex].connected = true;
        slaves[deviceIndex].lastUpdate = millis();
        slaves[deviceIndex].lastDataReceived = millis();
        slaves[deviceIndex].dataCount++;
        
        Serial.print("ðŸ“Š Data from ");
        Serial.print(slaves[deviceIndex].deviceName);
        Serial.print(" (#");
        Serial.print(deviceIndex + 1);
        Serial.print(") - Temp: ");
        Serial.print(receivedData.temperature, 1);
        Serial.print("Â°C, Humidity: ");
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

// ========== ë””ë²„ê·¸ ì •ë³´ ì¶œë ¥ ==========
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

// ========== Setup í•¨ìˆ˜ ==========
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
  
  esp_now_register_recv_cb(OnDataRecv);
  
  // ë¸Œë¡œë“œìºìŠ¤íŠ¸ í”¼ì–´ ì¶”ê°€
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
  
  // í•˜ë“œì›¨ì–´ í•€ ì´ˆê¸°í™”
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
  
  Serial.println("\n--- Initial Hardware Test ---");
  quickTest();
  
  loadRelayStates();
  updateShiftRegisters();
  
  Serial.println("\nInitializing PZEM-004T V3.0...");
  delay(500);
  
  Serial.println("\n=== System Ready ===");
  Serial.println("Commands: HELP, STATUS, DEVICES, DEBUG");
  Serial.println("Waiting for sensor slaves...\n");
}

// ========== Loop í•¨ìˆ˜ ==========
void loop() {
  handleSerialCommand();
  
  // ì„¼ì„œ ì½ê¸°
  static unsigned long lastSensorRead = 0;
  if (millis() - lastSensorRead > 100) {
    lastSensorRead = millis();
    readSensors();
  }
  
  // ìŠ¬ë ˆì´ë¸Œ ì—°ê²° ì²´í¬
  checkSlaveConnections();
  
  // ìžë™ ê¸‰ìˆ˜ ì²˜ë¦¬
  processAutoWatering();
  
  // ëª¨ë‹ˆí„° ëª¨ë“œ
  if (monitorMode) {
    static unsigned long lastMonitor = 0;
    if (millis() - lastMonitor > monitorInterval) {
      lastMonitor = millis();
      sendJSON();
    }
  }
  
  // ë””ë²„ê·¸ ì •ë³´ ì£¼ê¸°ì  ì¶œë ¥
  if (debugMode && millis() - lastDebugOutput > 10000) {
    lastDebugOutput = millis();
    printDebugInfo();
  }
  
  // ë¦´ë ˆì´ ìƒíƒœ ìžë™ ì €ìž¥
  if (pendingSave && lastRelayChange > 0 && !autoWatering.running) {
    if ((millis() - lastRelayChange > AUTO_SAVE_DELAY) && 
        (millis() - lastSaveTime > 60000)) {
      saveRelayStates(false);
    }
  }
  
  // ì¼ì¼ ì €ìž¥ ì¹´ìš´íŠ¸ ë¦¬ì…‹
  if (millis() - lastDayReset > 86400000UL) {
    dailySaveCount = 0;
    lastDayReset = millis();
    preferences.putUInt("dayReset", lastDayReset);
    preferences.putUShort("daily", 0);
  }
}

// ========== ë¦´ë ˆì´ ê´€ë ¨ í•¨ìˆ˜ ==========
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

// ========== ìžë™ ê¸‰ìˆ˜ í•¨ìˆ˜ ==========
void loadAutoWateringConfig() {
  autoWatering.delayA = preferences.getUInt("waterDelayA", 5);
  autoWatering.durationB = preferences.getUInt("waterDurationB", 10);
  autoWatering.cycleCount = preferences.getUShort("waterCycles", 3);
  autoWatering.enabled = false;
  autoWatering.running = false;
  autoWatering.currentCycle = 0;
  autoWatering.state = AutoWateringConfig::IDLE;
  autoWatering.lastSensorClearTime = 0;
  autoWatering.sensorDetectedTime = 0;
  
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
  
  Serial.println("\n=== AUTO WATERING STARTED ===");
  autoWatering.enabled = true;
  autoWatering.running = true;
  autoWatering.currentCycle = 0;
  autoWatering.state = AutoWateringConfig::WAIT_CLEAR;  // 먼저 센서 clear 대기
  autoWatering.stateStartTime = millis();
  autoWatering.sensorDetected = false;
  autoWatering.lastSensorClearTime = 0;  // 아직 clear 확인 안됨
  autoWatering.sensorDetectedTime = 0;
  
  setRelay(RELAY_MOTOR_FORWARD, true);
  setRelay(RELAY_MOTOR_SPEED1, true);
  
  Serial.println("Motor started: Forward + Speed1");
  Serial.println("Step 1: Waiting for proximity sensor to be CLEAR...");
}

void stopAutoWatering() {
  if (!autoWatering.running) {
    return;
  }
  
  Serial.println("\n=== AUTO WATERING STOPPED ===");
  
  autoWatering.enabled = false;
  autoWatering.running = false;
  autoWatering.state = AutoWateringConfig::IDLE;
  
  setRelay(RELAY_MOTOR_FORWARD, false);
  setRelay(RELAY_MOTOR_SPEED1, false);
  setRelay(RELAY_WATER_VALVE, false);
  
  Serial.println("All motors and valves stopped");
}

void processAutoWatering() {
  if (!autoWatering.running) return;
  
  unsigned long currentTime = millis();
  unsigned long elapsedTime = currentTime - autoWatering.stateStartTime;
  
  switch (autoWatering.state) {
    case AutoWateringConfig::WAIT_CLEAR:
      // Step 1: 센서가 clear(감지 안됨) 상태인지 확인
      if (!proximityState) {
        // 센서가 clear 상태임 - 이 시간을 기록하고 다음 단계로
        autoWatering.lastSensorClearTime = currentTime;
        autoWatering.state = AutoWateringConfig::WAIT_SENSOR;
        autoWatering.stateStartTime = currentTime;
        autoWatering.sensorDetected = false;
        
        Serial.print("\n[Cycle ");
        Serial.print(autoWatering.currentCycle + 1);
        Serial.print("/");
        Serial.print(autoWatering.cycleCount);
        Serial.println("]");
        Serial.println("Step 2: Sensor is CLEAR. Now waiting for object DETECTION...");
      } else {
        // 센서가 여전히 감지 상태 - 대기 (주기적으로 메시지 출력)
        if (elapsedTime > 0 && elapsedTime % 2000 < 100) {
          Serial.println("Waiting for sensor to be clear...");
        }
      }
      break;
      
    case AutoWateringConfig::WAIT_SENSOR:
      // Step 2: 센서가 감지됨 상태로 전환되기를 기다림
      if (proximityState && !autoWatering.sensorDetected) {
        // 센서가 감지됨!
        autoWatering.sensorDetected = true;
        autoWatering.sensorDetectedTime = currentTime;
        
        Serial.println("✅ Object DETECTED!");
        Serial.print("Waiting ");
        Serial.print(autoWatering.delayA);
        Serial.println(" seconds before watering...");
        
        autoWatering.state = AutoWateringConfig::DELAY_A;
        autoWatering.stateStartTime = currentTime;
      } else if (elapsedTime > 10000 && elapsedTime % 3000 < 100) {
        // 10초 이상 대기중일 때만 주기적으로 메시지 출력
        Serial.println("Still waiting for object detection...");
      }
      break;
      
    case AutoWateringConfig::DELAY_A:
      // Step 3: delayA 시간 동안 대기 (센서가 계속 감지되는지 확인)
      if (!proximityState) {
        // 센서가 사라짐 - 처음부터 다시
        Serial.println("⚠️ Object lost during delay - restarting detection");
        autoWatering.state = AutoWateringConfig::WAIT_CLEAR;
        autoWatering.stateStartTime = currentTime;
        autoWatering.sensorDetected = false;
      } else if (elapsedTime >= autoWatering.delayA * 1000) {
        // delayA 시간 경과 - 급수 시작
        Serial.println("✅ Delay complete. Starting water supply...");
        setRelay(RELAY_MOTOR_FORWARD, false);  // 모터 정지
        setRelay(RELAY_WATER_VALVE, true);     // 밸브 열기
        autoWatering.state = AutoWateringConfig::WATERING;
        autoWatering.stateStartTime = currentTime;
      } else {
        // 대기 중 - 진행 상황 표시 (1초마다)
        if (elapsedTime % 1000 < 100) {
          unsigned long remaining = (autoWatering.delayA * 1000 - elapsedTime) / 1000;
          Serial.print("⏳ Delay: ");
          Serial.print(remaining);
          Serial.println("s remaining...");
        }
      }
      break;
      
    case AutoWateringConfig::WATERING:
      // Step 4: 급수 중
      if (elapsedTime >= autoWatering.durationB * 1000) {
        // 급수 완료
        Serial.println("💧 Water supply complete for this cycle");
        setRelay(RELAY_WATER_VALVE, false);  // 밸브 닫기
        autoWatering.currentCycle++;
        
        if (autoWatering.currentCycle >= autoWatering.cycleCount) {
          // 모든 사이클 완료
          Serial.println("\n=== ✅ ALL CYCLES COMPLETE ===");
          setRelay(RELAY_MOTOR_FORWARD, true);  // 모터 재시작
          setRelay(RELAY_MOTOR_SPEED1, true);
          autoWatering.running = false;
          autoWatering.state = AutoWateringConfig::IDLE;
        } else {
          // 다음 사이클 준비
          Serial.print("\n--- Cycle ");
          Serial.print(autoWatering.currentCycle);
          Serial.print("/");
          Serial.print(autoWatering.cycleCount);
          Serial.println(" complete ---");
          Serial.println("Preparing for next cycle...");
          
          setRelay(RELAY_MOTOR_FORWARD, true);   // 모터 재시작
          setRelay(RELAY_MOTOR_SPEED1, true);
          
          // 다음 사이클을 위해 WAIT_CLEAR 상태로
          autoWatering.state = AutoWateringConfig::WAIT_CLEAR;
          autoWatering.stateStartTime = currentTime;
          autoWatering.sensorDetected = false;
          autoWatering.lastSensorClearTime = 0;
          autoWatering.sensorDetectedTime = 0;
        }
      } else {
        // 급수 중 - 진행 상황 표시 (1초마다)
        if (elapsedTime % 1000 < 100) {
          unsigned long remaining = (autoWatering.durationB * 1000 - elapsedTime) / 1000;
          Serial.print("💧 Watering: ");
          Serial.print(remaining);
          Serial.println("s remaining...");
        }
      }
      break;
  }
}

void printWaterStatus() {
  Serial.print("Status: ");
  if (autoWatering.running) {
    Serial.print("RUNNING - ");
    switch(autoWatering.state) {
      case AutoWateringConfig::WAIT_CLEAR:
        Serial.print("Waiting for sensor clear");
        break;
      case AutoWateringConfig::WAIT_SENSOR:
        Serial.print("Waiting for sensor detection");
        break;
      case AutoWateringConfig::DELAY_A:
        Serial.print("Delay phase");
        break;
      case AutoWateringConfig::WATERING:
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

// ========== ìŠ¬ë ˆì´ë¸Œ ê´€ë ¨ í•¨ìˆ˜ ==========
void checkSlaveConnections() {
  unsigned long currentTime = millis();
  
  for (int i = 0; i < slaveCount; i++) {
    if (slaves[i].connected) {
      if (currentTime - slaves[i].lastUpdate > SLAVE_TIMEOUT) {
        slaves[i].connected = false;
        Serial.print("âš ï¸ Device ");
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
        Serial.print("âœ… ONLINE");
      } else {
        Serial.print("âŒ OFFLINE");
      }
      
      Serial.println();
      
      // ìƒì„¸ ì •ë³´
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
          Serial.print("Â°C, Humidity: ");
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

// ========== ì„¼ì„œ ì½ê¸° í•¨ìˆ˜ ==========
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

// ========== ì¶œë ¥ í•¨ìˆ˜ ==========
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

// ========== ì‹œë¦¬ì–¼ ëª…ë ¹ ì²˜ë¦¬ ==========
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
  
  // ìŠ¬ë ˆì´ë¸Œ ê´€ë ¨ ëª…ë ¹
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
  // ìžë™ ê¸‰ìˆ˜ ê´€ë ¨ ëª…ë ¹
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
  // ë¦´ë ˆì´ ê´€ë ¨ ëª…ë ¹
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
  // ìƒíƒœ ë° ëª¨ë‹ˆí„°ë§
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
