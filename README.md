# 🌱 ESP32 Smart Auto-Watering System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ESP32](https://img.shields.io/badge/Platform-ESP32-blue.svg)](https://www.espressif.com/en/products/socs/esp32)
[![Python](https://img.shields.io/badge/Python-3.8+-green.svg)](https://www.python.org/)

ESP32 기반 지능형 자동 급수 시스템으로 근접 센서를 활용한 정확한 물체 감지와 안전한 급수를 제공합니다.

![System Overview](docs/images/system-overview.png)

## ✨ 주요 기능

### 🎯 스마트 급수 시스템
- **2단계 센서 감지**: Clear → Detect 전환 확인으로 오작동 방지
- **다중 사이클 지원**: 여러 화분에 순차적 자동 급수
- **안전 메커니즘**: 각 사이클마다 센서 상태 검증
- **실시간 피드백**: 진행 상황 이모지로 시각화

### 🔧 하드웨어 제어
- **16채널 릴레이 제어**: 74HC595 시프트 레지스터 활용
- **전력 모니터링**: PZEM-004T로 실시간 전압/전류/전력 측정
- **인터럽트 기반 센서**: 10ms 이하 응답 시간
- **자동 상태 저장**: Flash 메모리에 설정 자동 저장

### 📊 웹 인터페이스
- **실시간 대시보드**: WebSocket으로 즉각적인 상태 업데이트
- **데이터 시각화**: ECharts 기반 전력/센서 데이터 그래프
- **원격 제어**: 웹 브라우저에서 모든 기능 제어
- **데이터 관리**: SQLite 기반 센서 데이터 및 로그 저장

### 🌐 무선 통신
- **ESP-NOW 프로토콜**: 최대 10개 센서 슬레이브 지원
- **자동 페어링**: 슬레이브 자동 발견 및 등록
- **실시간 센서 데이터**: 온도, 습도, CO2, 조도 모니터링

## 📁 프로젝트 구조

```
esp32-auto-watering/
├── firmware/                    # ESP32 펌웨어
│   ├── MASTER_FIXED.ino        # 마스터 펌웨어 (급수 시스템)
│   └── SENSORS_FIXED.ino       # 슬레이브 펌웨어 (센서 노드)
│
├── backend/                     # Python 백엔드
│   ├── main_with_db.py         # FastAPI 서버
│   ├── serial_manager.py       # 시리얼 통신 관리
│   ├── db_manager.py           # SQLite 데이터베이스
│   ├── config.py               # 설정
│   └── models.py               # 데이터 모델
│
├── frontend/                    # 웹 프론트엔드
│   ├── index.html              # 메인 UI
│   ├── app.js                  # 프론트엔드 로직
│   └── style.css               # 스타일시트
│
└── docs/                        # 문서
    ├── CHANGES.md              # 변경 사항 및 동작 원리
    ├── TEST_GUIDE.md           # 테스트 가이드
    └── HARDWARE_SETUP.md       # 하드웨어 설정 (작성 예정)
```

## 🛠️ 하드웨어 요구사항

### 필수 구성품
| 구성품 | 수량 | 비고 |
|--------|------|------|
| ESP32 DevKit V1 | 1개 | 마스터 |
| ESP32 (옵션) | 0-10개 | 센서 슬레이브 |
| 근접 센서 (LJ12A3-4-Z/BX) | 1개 | NPN, NO 타입 |
| 74HC595 시프트 레지스터 | 2개 | 16채널용 |
| 16채널 릴레이 모듈 | 1개 | 12V |
| PZEM-004T V3.0 | 1개 | 전력 모니터 |
| 워터 펌프 | 1개 | 12V DC |
| 전자식 급수 밸브 | 1개 | 12V DC |
| 12V/5V 전원 공급 장치 | 1개 | 최소 3A |

### 센서 (옵션 - 슬레이브용)
- DHT22 (온습도)
- MH-Z19B (CO2)
- BH1750 (조도)

## 💻 소프트웨어 요구사항

### Arduino 환경
- Arduino IDE 1.8.x 이상
- ESP32 보드 패키지 2.0.x

### Python 환경
- Python 3.8 이상
- pip 패키지 관리자

## 🚀 빠른 시작

### 1. 저장소 클론

```bash
git clone https://github.com/yourusername/esp32-auto-watering.git
cd esp32-auto-watering
```

### 2. Arduino 라이브러리 설치

Arduino IDE에서 다음 라이브러리 설치:
- PZEM004Tv30
- ArduinoJson
- DHT sensor library (슬레이브용)
- Adafruit BH1750 (슬레이브용)

### 3. 펌웨어 업로드

```bash
# Arduino IDE에서
1. firmware/MASTER_FIXED.ino 열기
2. 보드: ESP32 Dev Module 선택
3. 포트 선택
4. 업로드
```

### 4. Python 의존성 설치

```bash
cd backend
pip install -r requirements.txt
```

### 5. 웹 서버 실행

```bash
python main_with_db.py
```

### 6. 웹 브라우저 접속

```
http://localhost:8000
```

## 📖 사용 방법

### 시리얼 명령어

```bash
# 자동 급수 설정 및 시작
WATER:5,10,3    # 5초 대기, 10초 급수, 3회 반복

# 급수 제어
WATER START     # 시작
WATER STOP      # 중단
WATER STATUS    # 상태 확인

# 릴레이 제어
R0:1           # 릴레이 0번 켜기
ON             # 모든 릴레이 켜기
OFF            # 모든 릴레이 끄기

# 상태 조회
STATUS         # 전체 상태
JSON           # JSON 형식
DEVICES        # 슬레이브 목록
```

### Python API

```python
import asyncio
from serial_manager import SerialManager

async def main():
    serial = SerialManager()
    await serial.connect()
    
    # 급수 설정 및 시작
    await serial.set_water_config(
        delay_a=5,      # 5초 대기
        duration_b=10,  # 10초 급수
        cycles=3        # 3회 반복
    )
    
    await serial.disconnect()

asyncio.run(main())
```

## 🌊 자동 급수 프로세스

```
1. WAIT_CLEAR (센서 clear 대기)
   ↓
2. WAIT_SENSOR (물체 감지 대기)
   ↓ 물체 감지됨
3. DELAY_A (설정 시간 대기)
   ↓ 시간 경과
4. WATERING (급수 실행)
   ↓
5. 다음 사이클 또는 완료
   → WAIT_CLEAR로 복귀
```

### 안전 메커니즘
- ✅ 각 사이클마다 센서 "clear → detect" 전환 확인
- ✅ Delay 중 센서 해제시 처음부터 재시작
- ✅ 릴레이 상태 자동 저장 (전원 꺼져도 복구)

## 📊 핀 연결

### ESP32 마스터

| 구성품 | ESP32 핀 | 설명 |
|--------|----------|------|
| PZEM RX | GPIO 16 | 전력 모니터 수신 |
| PZEM TX | GPIO 17 | 전력 모니터 송신 |
| 근접센서 | GPIO 18 | 인터럽트 입력 |
| 모터 속도 | GPIO 34 | ADC 입력 |
| 74HC595 Data | GPIO 14 | 시프트 레지스터 |
| 74HC595 Latch | GPIO 12 | 시프트 레지스터 |
| 74HC595 Clock | GPIO 13 | 시프트 레지스터 |
| 74HC595 OE | GPIO 5 | 출력 활성화 |

### 릴레이 매핑

| 릴레이 | 기능 |
|--------|------|
| R0 | 모터 속도 1단 |
| R4 | 급수 밸브 |
| R8 | 모터 전진 |
| R1-R15 | 추가 장치 (선택) |

## 🐛 문제 해결

<details>
<summary><b>센서가 반응하지 않음</b></summary>

- 센서 전원 확인 (12V)
- GPIO 18 연결 확인
- `STATUS` 명령으로 센서 상태 확인
- `DEBUG` 모드 활성화
</details>

<details>
<summary><b>릴레이가 동작하지 않음</b></summary>

- 74HC595 전원 및 연결 확인
- `SCAN` 명령으로 각 릴레이 테스트
- 릴레이 모듈 전원 확인 (12V)
</details>

<details>
<summary><b>물이 계속 나옴</b></summary>

- 최신 펌웨어(v2.0) 확인
- `WATER STOP` 명령 실행
- 긴급시 전원 차단
</details>

<details>
<summary><b>Python 연결 실패</b></summary>

```python
# 포트 확인
from serial_manager import SerialManager
ports = SerialManager.list_available_ports()
print(ports)

# 포트 직접 지정
serial = SerialManager(port='/dev/cu.usbserial-0001')
```
</details>

## 📈 시스템 사양

- **최대 슬레이브**: 10개 (ESP-NOW)
- **최대 릴레이**: 16개
- **센서 응답**: < 10ms (인터럽트)
- **통신 속도**: 115200 baud
- **플래시 저장**: 하루 최대 100회

## 🔒 안전 주의사항

⚠️ **전기 안전**
- 고전압 작업시 전문가 상담
- 릴레이 정격 확인
- 적절한 퓨즈 사용

💧 **물 안전**
- 방수 처리된 전자 부품 사용
- 펌프 과열 방지
- 역류 방지 밸브 권장

🔧 **시스템 안전**
- 긴급 정지 버튼 설치 권장
- 과급수 방지 설정
- 정기적인 점검

## 📝 변경 로그

### v2.0 (2024-11-04)
- ✅ WAIT_CLEAR 상태 추가
- ✅ 센서 감지 로직 개선
- ✅ 1초마다 물이 나오는 문제 해결
- ✅ 사용자 피드백 개선
- ✅ Python serial_manager 안정성 향상

### v1.0 (이전)
- 기본 자동 급수 기능
- ESP-NOW 통신
- 웹 인터페이스

자세한 내용은 [CHANGES.md](docs/CHANGES.md) 참조

## 🤝 기여하기

기여를 환영합니다! 다음 방법으로 참여하실 수 있습니다:

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 라이센스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일 참조

## 👨‍💻 저자

**Moon Young** - 전남농업기술원 수직농장 제어 시스템

## 🙏 감사의 글

- [ESP32 Arduino Core](https://github.com/espressif/arduino-esp32)
- [FastAPI](https://fastapi.tiangolo.com/)
- [ECharts](https://echarts.apache.org/)

## 📧 연락처

- GitHub Issues: [Issues Page](https://github.com/yourusername/esp32-auto-watering/issues)
- Email: your@email.com

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=yourusername/esp32-auto-watering&type=Date)](https://star-history.com/#yourusername/esp32-auto-watering&Date)

---

**Made with ❤️ for Smart Agriculture**
