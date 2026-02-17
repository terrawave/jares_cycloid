# 자동 급수 시스템 수정 사항

## 🔧 수정 날짜
2025-11-04

## 🎯 문제점
1. **물이 급수하고 나서 1초마다 계속 나오는 문제**
   - 급수가 끝나고 다음 사이클로 넘어갈 때, 센서가 여전히 감지 상태라면
   - "감지 안됨 → 감지됨" 전환 없이 바로 다음 사이클이 시작됨

2. **센서 감지 로직 문제**
   - WAIT_SENSOR 상태에서 과거의 `lastSensorClearTime`을 사용하여
   - 센서가 실제로 clear → detect 전환되지 않아도 조건을 만족함

## ✅ 해결 방법

### 1. State 추가: WAIT_CLEAR
기존 상태 흐름:
```
IDLE → WAIT_SENSOR → DELAY_A → WATERING → (다음 사이클)
```

새로운 상태 흐름:
```
IDLE → WAIT_CLEAR → WAIT_SENSOR → DELAY_A → WATERING → (다음 사이클)
       ↑______________________________________________|
```

### 2. 상태별 동작

#### WAIT_CLEAR (새로 추가)
- **목적**: 센서가 clear(감지 안됨) 상태인지 먼저 확인
- **동작**: 
  - `proximityState == false`일 때 → WAIT_SENSOR로 전환
  - `proximityState == true`이면 → 대기 (2초마다 메시지 출력)

#### WAIT_SENSOR
- **목적**: 센서가 감지됨 상태로 전환되기를 기다림
- **동작**:
  - `proximityState == true`로 전환되면 → DELAY_A로 전환
  - 10초 이상 대기시 → 3초마다 상태 메시지 출력

#### DELAY_A
- **목적**: delayA 시간 동안 대기하며 센서가 계속 감지되는지 확인
- **동작**:
  - 센서가 사라지면 (`proximityState == false`) → WAIT_CLEAR로 복귀
  - delayA 시간 경과 → WATERING으로 전환
  - 1초마다 남은 시간 출력

#### WATERING
- **목적**: durationB 시간 동안 급수
- **동작**:
  - 모터 정지, 밸브 열기
  - durationB 시간 경과 후:
    - 마지막 사이클이면 → 모든 시스템 정리
    - 다음 사이클이 있으면 → **WAIT_CLEAR로 복귀** (중요!)

### 3. 핵심 변경 사항

#### 구조체 변수 추가
```cpp
struct AutoWateringConfig {
  // ... 기존 변수들 ...
  unsigned long lastSensorClearTime;   // 센서가 clear된 시간
  unsigned long sensorDetectedTime;    // 센서가 감지된 시간
} autoWatering;
```

#### 초기화 변경
```cpp
void startAutoWatering() {
  // ...
  autoWatering.state = AutoWateringConfig::WAIT_CLEAR;  // ✅ WAIT_CLEAR로 시작
  autoWatering.lastSensorClearTime = 0;  // 아직 clear 확인 안됨
  autoWatering.sensorDetectedTime = 0;
  // ...
}
```

#### 사이클 전환시 변경
```cpp
// 다음 사이클 준비시
autoWatering.state = AutoWateringConfig::WAIT_CLEAR;  // ✅ WAIT_CLEAR로 복귀
autoWatering.lastSensorClearTime = 0;
autoWatering.sensorDetectedTime = 0;
```

## 📊 동작 플로우 차트

```
시작
  ↓
[WAIT_CLEAR] ─→ 센서 감지됨? ─YES→ 대기 (2초마다 메시지)
  ↓ NO                              ↑
  ↓ (센서 clear)                    │
  ↓                                 │
[WAIT_SENSOR] ─→ 센서 감지됨? ─NO→ 대기 (10초 후 메시지)
  ↓ YES                             ↑
  ↓ (물체 감지)                     │
  ↓                                 │
[DELAY_A] ─→ 센서 사라짐? ─YES→ WAIT_CLEAR로 복귀
  ↓ NO
  ↓ (delayA 초 경과)
  ↓
[WATERING] ─→ 급수 (durationB 초)
  ↓
  ├─→ 마지막 사이클? ─YES→ [완료]
  └─→ NO ─→ WAIT_CLEAR로 복귀 (다음 사이클)
```

## 🎨 사용자 피드백 개선

### 메시지 출력 개선
- ✅ 이모지 사용으로 가독성 향상
- ⏳ 진행 상황 실시간 표시 (1초마다)
- 📊 사이클 진행률 표시

### 예시 출력
```
=== AUTO WATERING STARTED ===
Motor started: Forward + Speed1
Step 1: Waiting for proximity sensor to be CLEAR...

[Cycle 1/3]
Step 2: Sensor is CLEAR. Now waiting for object DETECTION...
✅ Object DETECTED!
Waiting 5 seconds before watering...
⏳ Delay: 4s remaining...
⏳ Delay: 3s remaining...
⏳ Delay: 2s remaining...
⏳ Delay: 1s remaining...
✅ Delay complete. Starting water supply...
💧 Watering: 9s remaining...
💧 Watering: 8s remaining...
...
💧 Water supply complete for this cycle

--- Cycle 1/3 complete ---
Preparing for next cycle...
```

## 🧪 테스트 시나리오

### 시나리오 1: 정상 동작
1. 시작 → 센서 clear 대기
2. 센서 clear → 물체 감지 대기
3. 물체 감지 → 5초 대기
4. 급수 10초
5. 다음 사이클 시작 (1번부터 반복)

### 시나리오 2: 지연 중 물체 사라짐
1. 시작 → 센서 clear 대기
2. 센서 clear → 물체 감지 대기
3. 물체 감지 → 5초 대기 중
4. **물체 사라짐** → WAIT_CLEAR로 복귀
5. 처음부터 다시 시작

### 시나리오 3: 시작시 센서가 이미 감지 상태
1. 시작 → 센서 clear 대기
2. **센서가 계속 감지 상태** → "Waiting for sensor to be clear..." 메시지
3. 센서 clear되면 → 물체 감지 대기로 전환

## 📝 주의사항

1. **센서 안정성**
   - 센서가 clear → detect 전환을 명확히 감지
   - 잘못된 트리거 방지

2. **릴레이 제어**
   - RELAY_MOTOR_FORWARD (8번): 모터 전진
   - RELAY_MOTOR_SPEED1 (0번): 모터 속도 1단
   - RELAY_WATER_VALVE (4번): 급수 밸브

3. **타이밍**
   - delayA: 센서 감지 후 대기 시간 (기본 5초)
   - durationB: 급수 시간 (기본 10초)
   - cycleCount: 반복 횟수 (기본 3회)

## 🔗 관련 파일

- `MASTER_FIXED.ino` - ESP32 마스터 펌웨어 (수정됨)
- `serial_manager.py` - Python 시리얼 통신 관리자 (기존 유지)

## ✨ 결론

이제 자동 급수 시스템은 다음을 보장합니다:
- ✅ 센서가 "clear → detect" 전환을 명확히 감지
- ✅ 각 사이클마다 새로운 물체 감지 대기
- ✅ 1초마다 물이 나오는 문제 해결
- ✅ 명확한 사용자 피드백 제공
