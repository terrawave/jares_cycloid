# 자동 급수 시스템 테스트 가이드

## 🔌 하드웨어 연결

### 필수 연결
1. **PZEM-004T** (전력 모니터)
   - RX → GPIO 16
   - TX → GPIO 17

2. **근접 센서**
   - Signal → GPIO 18 (풀업 입력)

3. **모터 속도 센서**
   - ADC → GPIO 34

4. **74HC595 시프트 레지스터** (릴레이 제어)
   - Data → GPIO 14
   - Latch → GPIO 12
   - Clock → GPIO 13
   - OE → GPIO 5

### 릴레이 매핑
- R0: 모터 속도 1단
- R4: 급수 밸브
- R8: 모터 전진

## 📝 펌웨어 업로드

### Arduino IDE 설정
1. 보드: ESP32 Dev Module
2. Upload Speed: 921600
3. CPU Frequency: 240MHz
4. Flash Frequency: 80MHz
5. Flash Size: 4MB
6. Partition Scheme: Default

### 업로드
```bash
# Arduino IDE에서
1. MASTER_FIXED.ino 열기
2. 보드 설정 확인
3. 포트 선택
4. 업로드 버튼 클릭
```

## 🧪 단계별 테스트

### 1단계: 기본 연결 확인

#### 시리얼 모니터 오픈
- 보드레이트: 115200
- 줄바꿈: Both NL & CR

#### 확인 사항
```
===========================================
ESP32 MASTER - Interrupt Enhanced Version
===========================================
Master MAC Address: XX:XX:XX:XX:XX:XX
ESP-NOW initialized successfully
...
=== System Ready ===
```

### 2단계: 릴레이 테스트

#### 명령어
```
TEST        # 전체 릴레이 순간 테스트
SCAN        # 각 릴레이 순차 테스트
R0:1        # 릴레이 0번 켜기
R0:0        # 릴레이 0번 끄기
ON          # 모든 릴레이 켜기
OFF         # 모든 릴레이 끄기
```

#### 확인 사항
- 각 릴레이가 정상 동작하는지 확인
- 릴레이 소리 확인

### 3단계: 센서 테스트

#### 근접 센서
```
STATUS      # 현재 상태 확인
```

출력 예시:
```
--- Sensors ---
Proximity: DETECTED    # 또는 CLEAR
```

#### 센서 동작 확인
1. 물체를 센서 앞에 가져가기
2. 시리얼 모니터 확인:
```
🔔 Proximity sensor changed: DETECTED
```

3. 물체를 치우기
4. 시리얼 모니터 확인:
```
🔔 Proximity sensor changed: CLEAR
```

### 4단계: 자동 급수 설정 테스트

#### 설정만 하기 (시작 안함)
```
# 형식: WATER:delayA,durationB,cycles
WATER:2,3,2
```

출력:
```
OK:WATER Config set - Delay=2s, Duration=3s, Cycles=2
```

#### 설정 확인
```
WATER STATUS
```

출력:
```
Status: IDLE
Config: Delay=2s, Duration=3s, Cycles=2
```

### 5단계: 자동 급수 시뮬레이션 (짧은 시간)

#### 테스트 설정
```
# 2초 대기, 3초 급수, 2회 반복
WATER:2,3,2
```

#### 예상 동작 시퀀스

**초기 상태 (센서가 감지 안됨)**
```
=== AUTO WATERING STARTED ===
Motor started: Forward + Speed1
Step 1: Waiting for proximity sensor to be CLEAR...

[Cycle 1/2]
Step 2: Sensor is CLEAR. Now waiting for object DETECTION...
```

**물체를 센서 앞에 놓기**
```
✅ Object DETECTED!
Waiting 2 seconds before watering...
⏳ Delay: 1s remaining...
✅ Delay complete. Starting water supply...
💧 Watering: 2s remaining...
💧 Watering: 1s remaining...
💧 Water supply complete for this cycle

--- Cycle 1/2 complete ---
Preparing for next cycle...
Step 1: Waiting for proximity sensor to be CLEAR...
```

**물체를 치우고 다시 놓기**
```
[Cycle 2/2]
Step 2: Sensor is CLEAR. Now waiting for object DETECTION...
✅ Object DETECTED!
Waiting 2 seconds before watering...
⏳ Delay: 1s remaining...
✅ Delay complete. Starting water supply...
💧 Watering: 2s remaining...
💧 Watering: 1s remaining...
💧 Water supply complete for this cycle

=== ✅ ALL CYCLES COMPLETE ===
```

#### 릴레이 상태 확인
```
JSON
```

출력에서 확인:
```json
{
  "relays": [0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0],
  "water_running": 1
}
```

### 6단계: 중단 테스트

#### 실행 중 중단
```
WATER STOP
```

출력:
```
=== AUTO WATERING STOPPED ===
All motors and valves stopped
```

### 7단계: 실제 운영 설정

#### 실제 타이밍 설정
```
# 5초 대기, 10초 급수, 3회 반복
WATER:5,10,3
```

## 🐛 문제 해결

### 문제 1: 센서가 반응하지 않음
**확인 사항:**
- 센서 전원 연결 확인
- GPIO 18 연결 확인
- 시리얼 모니터에서 `STATUS` 명령으로 센서 상태 확인

**해결:**
```
# 디버그 모드 활성화
DEBUG
```

### 문제 2: 릴레이가 동작하지 않음
**확인 사항:**
- 74HC595 연결 확인
- 릴레이 모듈 전원 확인
- `SCAN` 명령으로 각 릴레이 테스트

**해결:**
```
SCAN        # 각 릴레이 순차 테스트
R8:1        # 모터 릴레이만 테스트
R4:1        # 밸브 릴레이만 테스트
```

### 문제 3: 물이 계속 나옴
**원인:** 이전 버전 펌웨어 사용 중
**해결:** 새 펌웨어 업로드

### 문제 4: 센서가 계속 감지 상태
**확인:**
```
STATUS
```

출력에서 `Proximity: DETECTED`가 계속 나오는 경우:
- 센서 앞의 장애물 제거
- 센서 감도 조정
- 센서 위치 조정

## 📊 모니터링

### 실시간 모니터링 활성화
```
MONITOR:1000    # 1초마다 JSON 데이터 출력
```

### 모니터링 비활성화
```
MONITOR:0
```

## 🎯 실전 운영 체크리스트

- [ ] 하드웨어 연결 확인
- [ ] 펌웨어 업로드 완료
- [ ] 릴레이 동작 확인 (TEST, SCAN)
- [ ] 센서 동작 확인 (물체 감지/제거)
- [ ] 짧은 시간으로 시뮬레이션 (WATER:2,3,2)
- [ ] 중단 기능 확인 (WATER STOP)
- [ ] 실제 타이밍으로 1회 테스트
- [ ] 전체 사이클 정상 동작 확인

## 📞 지원

문제 발생시:
1. `DEBUG` 모드 활성화
2. `STATUS` 명령으로 현재 상태 확인
3. `WATER STATUS`로 급수 시스템 상태 확인
4. 시리얼 로그 캡처하여 분석
