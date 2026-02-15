import os
from dotenv import load_dotenv
import platform
import serial.tools.list_ports

load_dotenv()

class Settings:
    # 서버 설정
    APP_NAME = "ESP32 Relay Control System"
    VERSION = "1.0.0"
    HOST = "0.0.0.0"
    PORT = 8000
    
    # 시리얼 포트 자동 감지 (Windows/Mac/Linux 공용)
    @staticmethod
    def get_serial_port():
        """자동으로 USB-TTL 장치 감지"""
        ports = serial.tools.list_ports.comports()
        
        # 디버깅용 포트 리스트 출력
        print("\n=== Available Serial Ports ===")
        for port in ports:
            print(f"Port: {port.device}")
            print(f"  Description: {port.description}")
            print(f"  Hardware ID: {port.hwid}")
            print(f"  Manufacturer: {port.manufacturer}")
            print("  ---")
        
        # 운영체제 확인
        system = platform.system()
        
        # Mac/Linux 우선순위 패턴 (FTDI, CH340 등 실제 USB-TTL 장치 우선)
        # debug-console, Bluetooth 등은 제외
        priority_patterns = [
            'usbserial',      # FTDI, CH340 등 USB 시리얼
            'usbmodem',       # Arduino 등
            'SLAB_USBtoUART', # Silicon Labs
            'wchusbserial',   # CH340
            'ttyUSB',         # Linux USB
            'ttyACM'          # Linux ACM
        ]
        
        # 제외할 패턴 (가상 포트, 블루투스 등)
        exclude_patterns = [
            'debug-console',
            'bluetooth',
            'wlan'
        ]
        
        if system == "Windows":
            # Windows에서는 모든 COM 포트를 시도
            for port in ports:
                if port.device.startswith('COM'):
                    print(f"Found Windows port: {port.device}")
                    return port.device
                    
        elif system == "Darwin":  # Mac
            # 우선순위 순서로 검색
            for pattern in priority_patterns:
                for port in ports:
                    device_lower = port.device.lower()
                    
                    # 제외 패턴 체크
                    should_exclude = False
                    for exclude in exclude_patterns:
                        if exclude in device_lower:
                            should_exclude = True
                            break
                    
                    if should_exclude:
                        continue
                    
                    # 우선순위 패턴 매칭
                    if pattern.lower() in device_lower:
                        # FTDI 장치 확인 (가장 신뢰할 수 있음)
                        if port.manufacturer and 'FTDI' in port.manufacturer:
                            print(f"✅ Found FTDI USB UART: {port.device}")
                            return port.device
                        
                        # 일반 USB 시리얼
                        if 'USB' in (port.description or '').upper():
                            print(f"✅ Found USB Serial: {port.device}")
                            return port.device
            
            # 패턴으로 못 찾은 경우, 제조사 기반 검색
            for port in ports:
                device_lower = port.device.lower()
                
                # 제외 패턴 체크
                should_exclude = False
                for exclude in exclude_patterns:
                    if exclude in device_lower:
                        should_exclude = True
                        break
                
                if should_exclude:
                    continue
                
                # 제조사 확인
                if port.manufacturer and port.manufacturer.upper() in ['FTDI', 'PROLIFIC', 'SILABS']:
                    print(f"✅ Found by manufacturer: {port.device} ({port.manufacturer})")
                    return port.device
                        
        else:  # Linux
            for port in ports:
                if '/dev/ttyUSB' in port.device or '/dev/ttyACM' in port.device:
                    print(f"Found Linux port: {port.device}")
                    return port.device
        
        # 포트를 찾지 못한 경우 사용자에게 알림
        print("\n!!! No USB-Serial device auto-detected !!!")
        print("Please check:")
        print("1. ESP32 is connected via USB")
        print("2. USB drivers are installed (FTDI, CH340, etc.)")
        print("3. No other program is using the port")
        print("\nAvailable ports were:")
        for port in ports:
            print(f"  - {port.device}: {port.description}")
        
        # 환경변수에서 가져오기
        env_port = os.getenv("SERIAL_PORT")
        if env_port:
            print(f"\nUsing port from .env file: {env_port}")
            return env_port
        
        # 마지막 수단: Mac에서 cu.usbserial로 시작하는 첫 번째 포트
        if system == "Darwin":
            for port in ports:
                if 'cu.usbserial' in port.device.lower():
                    print(f"\n⚠️  Fallback: Using {port.device}")
                    return port.device
            
        return None
    
    # 환경변수에서 우선 읽고, 없으면 자동 감지
    SERIAL_PORT = os.getenv("SERIAL_PORT") or get_serial_port.__func__()
    BAUD_RATE = int(os.getenv("BAUD_RATE", "115200"))
    
    # 데이터베이스
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./relay_control.db")
    
    # 로깅
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

settings = Settings()