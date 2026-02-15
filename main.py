from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import Request
from contextlib import asynccontextmanager
import asyncio
import uvicorn
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any
import json

from config import settings
from models import *
from serial_manager import SerialManager
from db_manager import DatabaseManager

# 로깅 설정
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 시리얼 매니저
serial_manager = SerialManager(port=settings.SERIAL_PORT, baudrate=settings.BAUD_RATE)

# 데이터베이스 매니저
db_manager = DatabaseManager()

# WebSocket 연결 관리
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
    
    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

# 주기적 데이터 저장 태스크
async def periodic_data_save():
    """1분마다 센서 데이터 및 전력 데이터를 데이터베이스에 저장"""
    while True:
        try:
            await asyncio.sleep(60)  # 1분마다
            
            status = serial_manager.get_status()
            
            # 슬레이브 센서 데이터 저장
            if 'slaves' in status and status['slaves']:
                for slave in status['slaves']:
                    db_manager.save_sensor_data(
                        device=slave.get('name', 'Unknown'),
                        temperature=slave.get('temperature'),
                        humidity=slave.get('humidity'),
                        co2=slave.get('co2'),
                        lux=slave.get('lux')
                    )
            
            # 마스터 전력 데이터 처리
            if 'master' in status and status['master']:
                master = status['master']
                
                # 실시간 전력 데이터 저장 (차트용)
                db_manager.save_power_realtime(
                    device='Master',
                    voltage=master.get('voltage'),
                    current=master.get('current'),
                    power=master.get('power')
                )
                
                # 누적전력량을 이용한 사용량 계산 및 저장
                energy = master.get('energy')
                power = master.get('power')
                if energy is not None:
                    db_manager.save_energy_reading(energy, power)
            
            logger.debug("Periodic data saved to database")
            
        except Exception as e:
            logger.error(f"Error in periodic data save: {e}")

# 시리얼 콜백 함수
async def on_data_update(data: Dict[str, Any]):
    """데이터 업데이트 시 WebSocket으로 브로드캐스트"""
    await manager.broadcast({
        'type': 'status_update',
        'data': data,
        'timestamp': datetime.now().isoformat()
    })

async def on_command_response(response: str):
    """명령 응답 처리"""
    logger.info(f"Command response: {response}")
    await manager.broadcast({
        'type': 'command_response',
        'response': response,
        'timestamp': datetime.now().isoformat()
    })

async def on_error(error: str):
    """에러 처리"""
    logger.error(f"Serial error: {error}")
    db_manager.save_system_log('error', error)
    await manager.broadcast({
        'type': 'error',
        'error': error,
        'timestamp': datetime.now().isoformat()
    })

# Lifespan 컨텍스트 매니저
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting ESP32 Control Server with Database...")
    
    # 시리얼 콜백 등록
    serial_manager.set_callback('data_update', on_data_update)
    serial_manager.set_callback('command_response', on_command_response)
    serial_manager.set_callback('error', on_error)
    
    # 시리얼 연결
    connected = await serial_manager.connect()
    if connected:
        logger.info("Serial connection established")
        db_manager.save_system_log('info', 'Serial connection established')
        # 모니터링 시작
        asyncio.create_task(start_monitoring())
        # 주기적 데이터 저장 시작
        asyncio.create_task(periodic_data_save())
    else:
        logger.warning("Failed to establish serial connection")
        db_manager.save_system_log('warning', 'Failed to establish serial connection')
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    db_manager.save_system_log('info', 'Server shutting down')
    await serial_manager.disconnect()
    db_manager.close()

# FastAPI 앱 초기화
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="ESP32 릴레이 및 센서 제어 시스템 (with Database)",
    lifespan=lifespan
)

# 정적 파일 및 템플릿
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

async def start_monitoring():
    """주기적 모니터링"""
    while True:
        if serial_manager.is_connected:
            await serial_manager.send_command("JSON")
        await asyncio.sleep(5)

# ==================== 기본 API 엔드포인트 ====================

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    """메인 페이지"""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "title": settings.APP_NAME
    })

@app.get("/api/status")
async def get_status():
    """시스템 상태 조회"""
    status = serial_manager.get_status()
    
    return {
        "connected": status['connected'],
        "serial_port": status.get('port', 'Not connected'),
        "relays": status['relays'],
        "relay_hex": status['relay_hex'],
        "master_power": status['master'],
        "slaves": status.get('slaves', []),
        "water_status": {
            'running': status.get('water_running', False),
            'config': serial_manager.water_config
        },
        "drain_status": {
            'running': status.get('drain_running', False),
            'progress': status.get('drain_progress', {
                'current_cycle': 0,
                'total_cycles': 0,
                'phase': 'idle',
                'phase_remaining': 0
            }),
            'config': serial_manager.drain_config
        },
        "last_update": datetime.now().isoformat()
    }

@app.post("/api/relay/{relay_num}")
async def control_relay(relay_num: int, state: bool):
    """개별 릴레이 제어"""
    if not 0 <= relay_num <= 15:
        raise HTTPException(status_code=400, detail="Invalid relay number")
    
    if not serial_manager.is_connected:
        return {"success": False, "message": "Serial not connected", "demo": True}
    
    success = await serial_manager.set_relay(relay_num, state)
    if success:
        # 데이터베이스에 로그 저장
        db_manager.save_relay_log(relay_num, f"Relay {relay_num}", "ON" if state else "OFF")
    
    if not success:
        raise HTTPException(status_code=503, detail="Serial communication failed")
    
    return {"success": True, "relay": relay_num, "state": state}

@app.post("/api/relay/all")
async def control_all_relays(command: RelayBulkCommand):
    """전체 릴레이 제어"""
    if len(command.states) != 16:
        raise HTTPException(status_code=400, detail="Must provide 16 relay states")
    
    if not serial_manager.is_connected:
        return {"success": False, "message": "Serial not connected", "demo": True}
    
    for i, state in enumerate(command.states):
        await serial_manager.set_relay(i, state)
        db_manager.save_relay_log(i, f"Relay {i}", "ON" if state else "OFF")
        await asyncio.sleep(0.05)
    
    return {"success": True, "states": command.states}

@app.post("/api/relay/all/{state}")
async def set_all_relays(state: str):
    """모든 릴레이 ON/OFF"""
    if state not in ["on", "off"]:
        raise HTTPException(status_code=400, detail="State must be 'on' or 'off'")
    
    if not serial_manager.is_connected:
        return {"success": False, "message": "Serial not connected", "demo": True}
    
    success = await serial_manager.set_all_relays(state == "on")
    if success:
        for i in range(16):
            db_manager.save_relay_log(i, f"Relay {i}", "ON" if state == "on" else "OFF")
    
    if not success:
        raise HTTPException(status_code=503, detail="Serial communication failed")
    
    return {"success": True, "state": state}

@app.post("/api/water")
async def control_water(command: WaterCommand):
    """자동 급수 제어"""
    if not serial_manager.is_connected:
        return {"success": False, "message": "Serial not connected", "demo": True}
    
    if command.action == "config" and command.config:
        success = await serial_manager.set_water_config(
            command.config.delay_a,
            command.config.duration_b,
            command.config.cycle_count
        )
    else:
        success = await serial_manager.control_water(command.action)
    
    if success:
        db_manager.save_system_log('info', f"Water system: {command.action}")
    
    if not success:
        raise HTTPException(status_code=503, detail="Serial communication failed")
    
    return {"success": True, "action": command.action}

@app.post("/api/drain")
async def control_drain(command: DrainCommand):
    """자동 배수 제어"""
    if not serial_manager.is_connected:
        return {"success": False, "message": "Serial not connected", "demo": True}

    if command.action == "config" and command.config:
        success = await serial_manager.set_drain_config(
            command.config.delay_a,
            command.config.duration_b,
            command.config.cycle_count
        )
    else:
        success = await serial_manager.control_drain(command.action)

    if success:
        db_manager.save_system_log('info', f"Drain system: {command.action}")

    if not success:
        raise HTTPException(status_code=503, detail="Serial communication failed")

    return {"success": True, "action": command.action}

# ==================== 센서 및 로그 데이터 API ====================

@app.get("/api/db/sensor_data")
async def get_sensor_data_api(limit: int = 100, offset: int = 0, device: str = None):
    """센서 데이터 조회"""
    data = db_manager.get_sensor_data(limit, offset, device)
    count = db_manager.get_sensor_count()
    return {"data": data, "total": count}

@app.get("/api/db/relay_logs")
async def get_relay_logs_api(limit: int = 100, offset: int = 0):
    """릴레이 로그 조회"""
    logs = db_manager.get_relay_logs(limit, offset)
    count = db_manager.get_relay_log_count()
    return {"logs": logs, "total": count}

@app.get("/api/db/system_logs")
async def get_system_logs_api(limit: int = 100, offset: int = 0):
    """시스템 로그 조회"""
    logs = db_manager.get_system_logs(limit, offset)
    count = db_manager.get_system_log_count()
    return {"logs": logs, "total": count}

@app.get("/api/db/sensor_data/period")
async def get_sensor_data_by_period_api(
    start_date: str,
    end_date: str,
    device: str = None
):
    """기간별 센서 데이터 조회"""
    data = db_manager.get_sensor_data_by_period(start_date, end_date, device)
    return {"data": data}

@app.delete("/api/db/sensor_data")
async def clear_sensor_data_api():
    """센서 데이터 삭제"""
    success = db_manager.clear_sensor_data()
    if success:
        return {"success": True, "message": "Sensor data cleared"}
    else:
        raise HTTPException(status_code=500, detail="Failed to clear sensor data")

@app.delete("/api/db/relay_logs")
async def clear_relay_logs_api():
    """릴레이 로그 삭제"""
    success = db_manager.clear_relay_logs()
    if success:
        return {"success": True, "message": "Relay logs cleared"}
    else:
        raise HTTPException(status_code=500, detail="Failed to clear relay logs")

@app.delete("/api/db/system_logs")
async def clear_system_logs_api():
    """시스템 로그 삭제"""
    success = db_manager.clear_system_logs()
    if success:
        return {"success": True, "message": "System logs cleared"}
    else:
        raise HTTPException(status_code=500, detail="Failed to clear system logs")

@app.get("/api/db/export/sensor_data")
async def export_sensor_data():
    """센서 데이터 CSV 내보내기"""
    data = db_manager.get_sensor_data(limit=10000)
    
    csv_content = "시간,장치,온도(°C),습도(%),CO2(ppm),조도(lux)\n"
    for row in data:
        csv_content += f"{row['timestamp']},{row['device']},{row['temperature'] or ''},{row['humidity'] or ''},{row['co2'] or ''},{row['lux'] or ''}\n"
    
    return {"csv": csv_content}

@app.get("/api/db/export/relay_logs")
async def export_relay_logs():
    """릴레이 로그 CSV 내보내기"""
    logs = db_manager.get_relay_logs(limit=10000)
    
    csv_content = "시간,릴레이,동작,상태\n"
    for row in logs:
        csv_content += f"{row['timestamp']},R{row['relay']},{row['action']},{row['state']}\n"
    
    return {"csv": csv_content}

# ==================== 전력 사용량 API 엔드포인트 ====================

@app.get("/api/db/power_realtime")
async def get_power_realtime_api(limit: int = 50):
    """실시간 전력 데이터 조회 (차트용)"""
    data = db_manager.get_power_realtime(limit)
    return {"data": data}

@app.get("/api/db/energy/hourly")
async def get_energy_hourly_api(date: str = None, limit: int = 24):
    """시간별 전력 사용량 조회"""
    data = db_manager.get_energy_hourly(date, limit)
    return {"data": data}

@app.get("/api/db/energy/daily")
async def get_energy_daily_api(
    start_date: str = None, 
    end_date: str = None, 
    limit: int = 30
):
    """일별 전력 사용량 조회"""
    data = db_manager.get_energy_daily(start_date, end_date, limit)
    return {"data": data}

@app.get("/api/db/energy/monthly")
async def get_energy_monthly_api(year: int = None, limit: int = 12):
    """월별 전력 사용량 조회"""
    data = db_manager.get_energy_monthly(year, limit)
    return {"data": data}

@app.get("/api/db/export/energy_hourly")
async def export_energy_hourly():
    """시간별 전력 사용량 CSV 내보내기"""
    data = db_manager.get_energy_hourly(limit=1000)
    
    csv_content = "날짜,시간,사용량(kWh),평균전력(W)\n"
    for row in data:
        csv_content += f"{row['date']},{row['hour']:02d}:00,{row['energy_kwh']:.3f},{row['avg_power'] or ''}\n"
    
    return {"csv": csv_content}

@app.get("/api/db/export/energy_daily")
async def export_energy_daily():
    """일별 전력 사용량 CSV 내보내기"""
    data = db_manager.get_energy_daily(limit=365)
    
    csv_content = "날짜,사용량(kWh),평균전력(W)\n"
    for row in data:
        csv_content += f"{row['date']},{row['energy_kwh']:.3f},{row['avg_power'] or ''}\n"
    
    return {"csv": csv_content}

@app.get("/api/db/export/energy_monthly")
async def export_energy_monthly():
    """월별 전력 사용량 CSV 내보내기"""
    data = db_manager.get_energy_monthly(limit=24)
    
    csv_content = "년도,월,사용량(kWh),평균전력(W)\n"
    for row in data:
        csv_content += f"{row['year']},{row['month']:02d},{row['energy_kwh']:.3f},{row['avg_power'] or ''}\n"
    
    return {"csv": csv_content}

# ==================== 기타 API ====================

@app.get("/api/ports")
async def get_available_ports():
    """사용 가능한 시리얼 포트 목록"""
    import serial.tools.list_ports
    ports = []
    for port in serial.tools.list_ports.comports():
        ports.append({
            "device": port.device,
            "description": port.description,
            "hwid": port.hwid
        })
    return {"ports": ports}

@app.get("/api/slaves")
async def get_slaves():
    """슬레이브 목록 조회"""
    status = serial_manager.get_status()
    return {"slaves": status.get('slaves', [])}

@app.post("/api/command")
async def send_raw_command(request: Request):
    """원시 명령 전송"""
    body = await request.json()
    command = body.get('command', '').strip()
    
    if not command:
        raise HTTPException(status_code=400, detail="Command is required")
    
    if not serial_manager.is_connected:
        return {"success": False, "message": "Serial not connected", "demo": True}
    
    success = await serial_manager.send_command(command.upper())
    if not success:
        raise HTTPException(status_code=503, detail="Serial communication failed")
    
    return {"success": True, "command": command}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket 연결"""
    await manager.connect(websocket)
    try:
        # 초기 상태 전송
        status = serial_manager.get_status()
        await websocket.send_json({
            'type': 'initial_status',
            'data': status
        })
        
        # 연결 유지
        while True:
            data = await websocket.receive_text()
            # 필요시 클라이언트 명령 처리
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# 실행
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
        log_level=settings.LOG_LEVEL.lower()
    )