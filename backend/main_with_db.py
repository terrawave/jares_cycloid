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

# ë¡œê¹… ì„¤ì •
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ì‹œë¦¬ì–¼ ë§¤ë‹ˆì €
serial_manager = SerialManager(port=settings.SERIAL_PORT, baudrate=settings.BAUD_RATE)

# ë°ì´í„°ë² ì´ìŠ¤ ë§¤ë‹ˆì €
db_manager = DatabaseManager()

# WebSocket ì—°ê²° ê´€ë¦¬
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

# ì£¼ê¸°ì  ë°ì´í„° ì €ìž¥ íƒœìŠ¤í¬
async def periodic_data_save():
    """1ë¶„ë§ˆë‹¤ ì„¼ì„œ ë°ì´í„° ë° ì „ë ¥ ë°ì´í„°ë¥¼ ë°ì´í„°ë² ì´ìŠ¤ì— ì €ìž¥"""
    while True:
        try:
            await asyncio.sleep(60)  # 1ë¶„ë§ˆë‹¤
            
            status = serial_manager.get_status()
            
            # ìŠ¬ë ˆì´ë¸Œ ì„¼ì„œ ë°ì´í„° ì €ìž¥
            if 'slaves' in status and status['slaves']:
                for slave in status['slaves']:
                    db_manager.save_sensor_data(
                        device=slave.get('name', 'Unknown'),
                        temperature=slave.get('temperature'),
                        humidity=slave.get('humidity'),
                        co2=slave.get('co2'),
                        lux=slave.get('lux')
                    )
            
            # ë§ˆìŠ¤í„° ì „ë ¥ ë°ì´í„° ì²˜ë¦¬
            if 'master' in status and status['master']:
                master = status['master']
                
                # ì‹¤ì‹œê°„ ì „ë ¥ ë°ì´í„° ì €ìž¥ (ì°¨íŠ¸ìš©)
                db_manager.save_power_realtime(
                    device='Master',
                    voltage=master.get('voltage'),
                    current=master.get('current'),
                    power=master.get('power')
                )
                
                # ëˆ„ì ì „ë ¥ëŸ‰ì„ ì´ìš©í•œ ì‚¬ìš©ëŸ‰ ê³„ì‚° ë° ì €ìž¥
                energy = master.get('energy')
                power = master.get('power')
                if energy is not None:
                    db_manager.save_energy_reading(energy, power)
            
            logger.debug("Periodic data saved to database")
            
        except Exception as e:
            logger.error(f"Error in periodic data save: {e}")

# ì‹œë¦¬ì–¼ ì½œë°± í•¨ìˆ˜
async def on_data_update(data: Dict[str, Any]):
    """ë°ì´í„° ì—…ë°ì´íŠ¸ ì‹œ WebSocketìœ¼ë¡œ ë¸Œë¡œë“œìºìŠ¤íŠ¸"""
    await manager.broadcast({
        'type': 'status_update',
        'data': data,
        'timestamp': datetime.now().isoformat()
    })

async def on_command_response(response: str):
    """ëª…ë ¹ ì‘ë‹µ ì²˜ë¦¬"""
    logger.info(f"Command response: {response}")
    await manager.broadcast({
        'type': 'command_response',
        'response': response,
        'timestamp': datetime.now().isoformat()
    })

async def on_error(error: str):
    """ì—ëŸ¬ ì²˜ë¦¬"""
    logger.error(f"Serial error: {error}")
    db_manager.save_system_log('error', error)
    await manager.broadcast({
        'type': 'error',
        'error': error,
        'timestamp': datetime.now().isoformat()
    })

# Lifespan ì»¨í…ìŠ¤íŠ¸ ë§¤ë‹ˆì €
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting ESP32 Control Server with Database...")
    
    # ì‹œë¦¬ì–¼ ì½œë°± ë“±ë¡
    serial_manager.set_callback('data_update', on_data_update)
    serial_manager.set_callback('command_response', on_command_response)
    serial_manager.set_callback('error', on_error)
    
    # ì‹œë¦¬ì–¼ ì—°ê²°
    connected = await serial_manager.connect()
    if connected:
        logger.info("Serial connection established")
        db_manager.save_system_log('info', 'Serial connection established')
        # ëª¨ë‹ˆí„°ë§ ì‹œìž‘
        asyncio.create_task(start_monitoring())
        # ì£¼ê¸°ì  ë°ì´í„° ì €ìž¥ ì‹œìž‘
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

# FastAPI ì•± ì´ˆê¸°í™”
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="ESP32 ë¦´ë ˆì´ ë° ì„¼ì„œ ì œì–´ ì‹œìŠ¤í…œ (with Database)",
    lifespan=lifespan
)

# ì •ì  íŒŒì¼ ë° í…œí”Œë¦¿
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

async def start_monitoring():
    """ì£¼ê¸°ì  ëª¨ë‹ˆí„°ë§"""
    while True:
        if serial_manager.is_connected:
            await serial_manager.send_command("JSON")
        await asyncio.sleep(5)

# ==================== ê¸°ë³¸ API ì—”ë“œí¬ì¸íŠ¸ ====================

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    """ë©”ì¸ íŽ˜ì´ì§€"""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "title": settings.APP_NAME
    })

@app.get("/api/status")
async def get_status():
    """ì‹œìŠ¤í…œ ìƒíƒœ ì¡°íšŒ"""
    status = serial_manager.get_status()
    
    return {
        "connected": status['connected'],
        "serial_port": status.get('port', 'Not connected'),
        "relays": status['relays'],
        "relay_hex": status['relay_hex'],
        "master_power": status['master'],
        "slaves": status.get('slaves', []),
        "water_status": {
            'running': status.get('water_running', False)
        },
        "last_update": datetime.now().isoformat()
    }

@app.post("/api/relay/{relay_num}")
async def control_relay(relay_num: int, state: bool):
    """ê°œë³„ ë¦´ë ˆì´ ì œì–´"""
    if not 0 <= relay_num <= 15:
        raise HTTPException(status_code=400, detail="Invalid relay number")
    
    if not serial_manager.is_connected:
        return {"success": False, "message": "Serial not connected", "demo": True}
    
    success = await serial_manager.set_relay(relay_num, state)
    if success:
        # ë°ì´í„°ë² ì´ìŠ¤ì— ë¡œê·¸ ì €ìž¥
        db_manager.save_relay_log(relay_num, f"Relay {relay_num}", "ON" if state else "OFF")
    
    if not success:
        raise HTTPException(status_code=503, detail="Serial communication failed")
    
    return {"success": True, "relay": relay_num, "state": state}

@app.post("/api/relay/all")
async def control_all_relays(command: RelayBulkCommand):
    """ì „ì²´ ë¦´ë ˆì´ ì œì–´"""
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
    """ëª¨ë“  ë¦´ë ˆì´ ON/OFF"""
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
    """ìžë™ ê¸‰ìˆ˜ ì œì–´"""
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

# ==================== ì„¼ì„œ ë° ë¡œê·¸ ë°ì´í„° API ====================

@app.get("/api/db/sensor_data")
async def get_sensor_data_api(limit: int = 100, offset: int = 0, device: str = None):
    """ì„¼ì„œ ë°ì´í„° ì¡°íšŒ"""
    data = db_manager.get_sensor_data(limit, offset, device)
    count = db_manager.get_sensor_count()
    return {"data": data, "total": count}

@app.get("/api/db/relay_logs")
async def get_relay_logs_api(limit: int = 100, offset: int = 0):
    """ë¦´ë ˆì´ ë¡œê·¸ ì¡°íšŒ"""
    logs = db_manager.get_relay_logs(limit, offset)
    count = db_manager.get_relay_log_count()
    return {"logs": logs, "total": count}

@app.get("/api/db/system_logs")
async def get_system_logs_api(limit: int = 100, offset: int = 0):
    """ì‹œìŠ¤í…œ ë¡œê·¸ ì¡°íšŒ"""
    logs = db_manager.get_system_logs(limit, offset)
    count = db_manager.get_system_log_count()
    return {"logs": logs, "total": count}

@app.get("/api/db/sensor_data/period")
async def get_sensor_data_by_period_api(
    start_date: str,
    end_date: str,
    device: str = None
):
    """ê¸°ê°„ë³„ ì„¼ì„œ ë°ì´í„° ì¡°íšŒ"""
    data = db_manager.get_sensor_data_by_period(start_date, end_date, device)
    return {"data": data}

@app.delete("/api/db/sensor_data")
async def clear_sensor_data_api():
    """ì„¼ì„œ ë°ì´í„° ì‚­ì œ"""
    success = db_manager.clear_sensor_data()
    if success:
        return {"success": True, "message": "Sensor data cleared"}
    else:
        raise HTTPException(status_code=500, detail="Failed to clear sensor data")

@app.delete("/api/db/relay_logs")
async def clear_relay_logs_api():
    """ë¦´ë ˆì´ ë¡œê·¸ ì‚­ì œ"""
    success = db_manager.clear_relay_logs()
    if success:
        return {"success": True, "message": "Relay logs cleared"}
    else:
        raise HTTPException(status_code=500, detail="Failed to clear relay logs")

@app.delete("/api/db/system_logs")
async def clear_system_logs_api():
    """ì‹œìŠ¤í…œ ë¡œê·¸ ì‚­ì œ"""
    success = db_manager.clear_system_logs()
    if success:
        return {"success": True, "message": "System logs cleared"}
    else:
        raise HTTPException(status_code=500, detail="Failed to clear system logs")

@app.get("/api/db/export/sensor_data")
async def export_sensor_data():
    """ì„¼ì„œ ë°ì´í„° CSV ë‚´ë³´ë‚´ê¸°"""
    data = db_manager.get_sensor_data(limit=10000)
    
    csv_content = "ì‹œê°„,ìž¥ì¹˜,ì˜¨ë„(Â°C),ìŠµë„(%),CO2(ppm),ì¡°ë„(lux)\n"
    for row in data:
        csv_content += f"{row['timestamp']},{row['device']},{row['temperature'] or ''},{row['humidity'] or ''},{row['co2'] or ''},{row['lux'] or ''}\n"
    
    return {"csv": csv_content}

@app.get("/api/db/export/relay_logs")
async def export_relay_logs():
    """ë¦´ë ˆì´ ë¡œê·¸ CSV ë‚´ë³´ë‚´ê¸°"""
    logs = db_manager.get_relay_logs(limit=10000)
    
    csv_content = "ì‹œê°„,ë¦´ë ˆì´,ë™ìž‘,ìƒíƒœ\n"
    for row in logs:
        csv_content += f"{row['timestamp']},R{row['relay']},{row['action']},{row['state']}\n"
    
    return {"csv": csv_content}

# ==================== ì „ë ¥ ì‚¬ìš©ëŸ‰ API ì—”ë“œí¬ì¸íŠ¸ ====================

@app.get("/api/db/power_realtime")
async def get_power_realtime_api(limit: int = 50):
    """ì‹¤ì‹œê°„ ì „ë ¥ ë°ì´í„° ì¡°íšŒ (ì°¨íŠ¸ìš©)"""
    data = db_manager.get_power_realtime(limit)
    return {"data": data}

@app.get("/api/db/energy/hourly")
async def get_energy_hourly_api(date: str = None, limit: int = 24):
    """ì‹œê°„ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ ì¡°íšŒ"""
    data = db_manager.get_energy_hourly(date, limit)
    return {"data": data}

@app.get("/api/db/energy/daily")
async def get_energy_daily_api(
    start_date: str = None, 
    end_date: str = None, 
    limit: int = 30
):
    """ì¼ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ ì¡°íšŒ"""
    data = db_manager.get_energy_daily(start_date, end_date, limit)
    return {"data": data}

@app.get("/api/db/energy/monthly")
async def get_energy_monthly_api(year: int = None, limit: int = 12):
    """ì›”ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ ì¡°íšŒ"""
    data = db_manager.get_energy_monthly(year, limit)
    return {"data": data}

@app.get("/api/db/export/energy_hourly")
async def export_energy_hourly():
    """ì‹œê°„ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ CSV ë‚´ë³´ë‚´ê¸°"""
    data = db_manager.get_energy_hourly(limit=1000)
    
    csv_content = "ë‚ ì§œ,ì‹œê°„,ì‚¬ìš©ëŸ‰(kWh),í‰ê· ì „ë ¥(W)\n"
    for row in data:
        csv_content += f"{row['date']},{row['hour']:02d}:00,{row['energy_kwh']:.3f},{row['avg_power'] or ''}\n"
    
    return {"csv": csv_content}

@app.get("/api/db/export/energy_daily")
async def export_energy_daily():
    """ì¼ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ CSV ë‚´ë³´ë‚´ê¸°"""
    data = db_manager.get_energy_daily(limit=365)
    
    csv_content = "ë‚ ì§œ,ì‚¬ìš©ëŸ‰(kWh),í‰ê· ì „ë ¥(W)\n"
    for row in data:
        csv_content += f"{row['date']},{row['energy_kwh']:.3f},{row['avg_power'] or ''}\n"
    
    return {"csv": csv_content}

@app.get("/api/db/export/energy_monthly")
async def export_energy_monthly():
    """ì›”ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ CSV ë‚´ë³´ë‚´ê¸°"""
    data = db_manager.get_energy_monthly(limit=24)
    
    csv_content = "ë…„ë„,ì›”,ì‚¬ìš©ëŸ‰(kWh),í‰ê· ì „ë ¥(W)\n"
    for row in data:
        csv_content += f"{row['year']},{row['month']:02d},{row['energy_kwh']:.3f},{row['avg_power'] or ''}\n"
    
    return {"csv": csv_content}

# ==================== ê¸°íƒ€ API ====================

@app.get("/api/ports")
async def get_available_ports():
    """ì‚¬ìš© ê°€ëŠ¥í•œ ì‹œë¦¬ì–¼ í¬íŠ¸ ëª©ë¡"""
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
    """ìŠ¬ë ˆì´ë¸Œ ëª©ë¡ ì¡°íšŒ"""
    status = serial_manager.get_status()
    return {"slaves": status.get('slaves', [])}

@app.post("/api/command")
async def send_raw_command(request: Request):
    """ì›ì‹œ ëª…ë ¹ ì „ì†¡"""
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
    """WebSocket ì—°ê²°"""
    await manager.connect(websocket)
    try:
        # ì´ˆê¸° ìƒíƒœ ì „ì†¡
        status = serial_manager.get_status()
        await websocket.send_json({
            'type': 'initial_status',
            'data': status
        })
        
        # ì—°ê²° ìœ ì§€
        while True:
            data = await websocket.receive_text()
            # í•„ìš”ì‹œ í´ë¼ì´ì–¸íŠ¸ ëª…ë ¹ ì²˜ë¦¬
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ì‹¤í–‰
if __name__ == "__main__":
    uvicorn.run(
        "main_with_db:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
        log_level=settings.LOG_LEVEL.lower()
    )