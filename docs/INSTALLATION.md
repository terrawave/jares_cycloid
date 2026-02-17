# 📦 설치 가이드

## 📋 목차
- [시스템 요구사항](#시스템-요구사항)
- [Arduino IDE 설정](#arduino-ide-설정)
- [Python 환경 설정](#python-환경-설정)
- [펌웨어 업로드](#펌웨어-업로드)
- [백엔드 서버 실행](#백엔드-서버-실행)
- [자동 시작 설정](#자동-시작-설정)

## 💻 시스템 요구사항

### 운영체제
- Windows 10/11
- macOS 10.15+
- Linux (Ubuntu 20.04+)

### 소프트웨어
- Arduino IDE 1.8.19 이상
- Python 3.8 이상
- Git (옵션)
- Chrome/Edge/Firefox (최신 버전)

## 🔧 Arduino IDE 설정

### 1. Arduino IDE 설치

**Windows/macOS:**
```bash
https://www.arduino.cc/en/software
```

**Linux (Ubuntu):**
```bash
sudo apt update
sudo apt install arduino
```

### 2. ESP32 보드 패키지 설치

1. Arduino IDE 실행
2. **파일** → **환경설정**
3. **추가 보드 매니저 URLs**에 추가:
```
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
```

4. **도구** → **보드** → **보드 매니저**
5. "ESP32" 검색 후 설치 (버전 2.0.x 권장)

### 3. 필수 라이브러리 설치

**스케치** → **라이브러리 포함하기** → **라이브러리 관리**에서 검색 및 설치:

#### 마스터용 라이브러리
```
1. PZEM004Tv30 by Jakub Mandula
2. ArduinoJson by Benoit Blanchon (버전 6.x)
```

#### 슬레이브용 라이브러리 (옵션)
```
1. DHT sensor library by Adafruit
2. Adafruit BH1750
3. MH-Z19 (GitHub에서 수동 설치)
```

### 4. 보드 설정

**도구** 메뉴에서:
```
- 보드: "ESP32 Dev Module"
- Upload Speed: 921600
- CPU Frequency: 240MHz (WiFi/BT)
- Flash Frequency: 80MHz
- Flash Mode: QIO
- Flash Size: 4MB (32Mb)
- Partition Scheme: Default 4MB with spiffs
- Core Debug Level: None
- PSRAM: Disabled
```

## 🐍 Python 환경 설정

### 1. Python 설치 확인

```bash
python --version
# 또는
python3 --version
```

출력 예시: `Python 3.8.10` 이상이어야 함

**Python 설치 (없는 경우):**

**Windows:**
```bash
https://www.python.org/downloads/
```
설치시 "Add Python to PATH" 체크!

**macOS:**
```bash
brew install python@3.11
```

**Linux:**
```bash
sudo apt update
sudo apt install python3 python3-pip
```

### 2. 가상환경 생성 (권장)

```bash
# 프로젝트 폴더로 이동
cd esp32-auto-watering/backend

# 가상환경 생성
python -m venv venv

# 가상환경 활성화
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate
```

### 3. 의존성 설치

```bash
pip install -r requirements.txt
```

설치되는 패키지:
- fastapi (웹 프레임워크)
- uvicorn (ASGI 서버)
- pyserial (시리얼 통신)
- pydantic (데이터 검증)
- websockets (실시간 통신)
- jinja2 (템플릿)

## 📤 펌웨어 업로드

### 마스터 펌웨어 업로드

1. **Arduino IDE에서 펌웨어 열기**
```bash
firmware/MASTER_FIXED.ino
```

2. **ESP32 연결**
   - USB 케이블로 ESP32 연결
   - 드라이버 자동 설치 대기 (Windows)

3. **포트 선택**
   - **도구** → **포트**
   - COM 포트 선택 (Windows: COM3, COM4 등)
   - macOS/Linux: /dev/cu.usbserial-xxxx 또는 /dev/ttyUSB0

4. **업로드**
   - ✅ 버튼 클릭 (검증)
   - ➡️ 버튼 클릭 (업로드)
   - 업로드 완료 대기 (약 30초)

5. **시리얼 모니터 확인**
   - **도구** → **시리얼 모니터**
   - 보드레이트: 115200
   - 줄바꿈: Both NL & CR

출력 예시:
```
===========================================
ESP32 MASTER - Interrupt Enhanced Version
===========================================
Master MAC Address: XX:XX:XX:XX:XX:XX
ESP-NOW initialized successfully
...
=== System Ready ===
```

### 슬레이브 펌웨어 업로드 (옵션)

동일한 방법으로 `firmware/SENSORS_FIXED.ino` 업로드

## 🚀 백엔드 서버 실행

### 1. 설정 파일 확인

`backend/config.py` 파일에서 설정 확인:

```python
SERIAL_PORT = None  # None이면 자동 감지
BAUD_RATE = 115200
HOST = "0.0.0.0"
PORT = 8000
```

### 2. 서버 실행

```bash
cd backend
python main_with_db.py
```

출력 예시:
```
INFO:     Started server process
INFO:     Waiting for application startup.
Starting ESP32 Control Server with Database...
✅ Connected to /dev/cu.usbserial-0001 at 115200 baud
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 3. 웹 브라우저 접속

```
http://localhost:8000
```

또는 네트워크 내 다른 기기에서:
```
http://[컴퓨터IP]:8000
```

IP 확인:
- Windows: `ipconfig`
- macOS/Linux: `ifconfig` 또는 `ip addr`

## 🔄 자동 시작 설정

### macOS (Launch Agent)

1. **plist 파일 생성**
```bash
nano ~/Library/LaunchAgents/com.esp32.autowater.plist
```

2. **내용 입력**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.esp32.autowater</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/python3</string>
        <string>/Users/[USERNAME]/esp32-auto-watering/backend/main_with_db.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/esp32-autowater.err</string>
    <key>StandardOutPath</key>
    <string>/tmp/esp32-autowater.out</string>
</dict>
</plist>
```

3. **서비스 등록**
```bash
launchctl load ~/Library/LaunchAgents/com.esp32.autowater.plist
```

### Linux (systemd)

1. **서비스 파일 생성**
```bash
sudo nano /etc/systemd/system/esp32-autowater.service
```

2. **내용 입력**
```ini
[Unit]
Description=ESP32 Auto Watering System
After=network.target

[Service]
Type=simple
User=yourusername
WorkingDirectory=/home/yourusername/esp32-auto-watering/backend
ExecStart=/usr/bin/python3 /home/yourusername/esp32-auto-watering/backend/main_with_db.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

3. **서비스 활성화**
```bash
sudo systemctl daemon-reload
sudo systemctl enable esp32-autowater
sudo systemctl start esp32-autowater

# 상태 확인
sudo systemctl status esp32-autowater
```

### Windows (작업 스케줄러)

1. **배치 파일 생성** (`start_server.bat`)
```batch
@echo off
cd C:\path\to\esp32-auto-watering\backend
python main_with_db.py
pause
```

2. **작업 스케줄러 설정**
   - 작업 스케줄러 실행
   - 기본 작업 만들기
   - 트리거: 컴퓨터 시작할 때
   - 작업: 프로그램 시작 → `start_server.bat` 선택

## ✅ 설치 확인

### 체크리스트

- [ ] Arduino IDE 설치 및 ESP32 보드 추가
- [ ] 필수 라이브러리 설치
- [ ] 펌웨어 업로드 성공
- [ ] 시리얼 모니터에서 "System Ready" 확인
- [ ] Python 가상환경 생성
- [ ] 의존성 설치 완료
- [ ] 백엔드 서버 실행 성공
- [ ] 웹 브라우저 접속 확인
- [ ] 릴레이 제어 테스트 (TEST 명령)
- [ ] 센서 값 확인 (STATUS 명령)

### 테스트 명령

```bash
# 시리얼 모니터에서
STATUS      # 전체 상태 확인
TEST        # 릴레이 테스트
DEVICES     # 슬레이브 목록
JSON        # JSON 출력 테스트
```

## 🐛 문제 해결

### ESP32 포트가 안 보임
- USB 드라이버 설치 (CP210x, CH340)
- USB 케이블 교체 (데이터 전송 지원 케이블)
- 다른 USB 포트 시도

### Python 모듈 설치 실패
```bash
# 관리자 권한으로 재시도
sudo pip install -r requirements.txt

# 또는 사용자 모드
pip install --user -r requirements.txt
```

### 시리얼 포트 권한 에러 (Linux)
```bash
sudo usermod -a -G dialout $USER
# 로그아웃 후 재로그인
```

### 웹 페이지 접속 안됨
- 방화벽 8000 포트 열기
- 서버 로그 확인
- 브라우저 캐시 삭제

## 📞 지원

문제가 계속되면:
- GitHub Issues
- 설치 로그 첨부
- 운영체제 및 버전 명시

---

**설치 완료! 🎉 이제 [테스트 가이드](TEST_GUIDE.md)를 참조하세요.**
