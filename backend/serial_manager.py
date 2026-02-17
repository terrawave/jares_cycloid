import asyncio
import serial
import serial.tools.list_ports
from serial import Serial
import json
import logging
from typing import Optional, Dict, Any, Callable
from datetime import datetime
import re

logger = logging.getLogger(__name__)

class SerialManager:
    def __init__(self, port: str = None, baudrate: int = 115200):
        self.port = port
        self.baudrate = baudrate
        self.serial: Optional[Serial] = None
        self.is_connected = False
        self.read_task: Optional[asyncio.Task] = None
        self.callbacks: Dict[str, Callable] = {}
        self.system_data = {
            'relays': [False] * 16,
            'relay_hex': '0x0000',
            'master': {
                'voltage': 0,
                'current': 0,
                'power': 0,
                'energy': 0,
                'frequency': 0,
                'pf': 0,
                'motor_adc': 0,
                'proximity': False
            },
            'slaves': [],
            'water_running': False
        }
        
    def auto_detect_port(self) -> Optional[str]:
        """USB-TTL í¬íŠ¸ ìžë™ ê°ì§€"""
        patterns = ['usbserial', 'usbmodem', 'SLAB_USBtoUART', 'wchusbserial']
        
        ports = serial.tools.list_ports.comports()
        for port in ports:
            logger.info(f"Found port: {port.device} - {port.description}")
            for pattern in patterns:
                if pattern.lower() in port.device.lower():
                    logger.info(f"Auto-detected serial port: {port.device}")
                    return port.device
        
        logger.warning("No USB-TTL device found")
        return None
    
    async def connect(self) -> bool:
        """ì‹œë¦¬ì–¼ í¬íŠ¸ ì—°ê²°"""
        try:
            # í¬íŠ¸ê°€ ì§€ì •ë˜ì§€ ì•Šì•˜ìœ¼ë©´ ìžë™ ê°ì§€
            if not self.port:
                self.port = self.auto_detect_port()
                if not self.port:
                    raise Exception("No serial port found")
            
            self.serial = Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=0.1
            )
            
            self.is_connected = True
            
            # ì½ê¸° íƒœìŠ¤í¬ ì‹œìž‘
            self.read_task = asyncio.create_task(self._read_loop())
            
            # ì´ˆê¸° ìƒíƒœ ìš”ì²­
            await asyncio.sleep(2)
            await self.send_command("STATUS")
            
            logger.info(f"Connected to {self.port} at {self.baudrate} baud")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            self.is_connected = False
            return False
    
    async def disconnect(self):
        """ì‹œë¦¬ì–¼ í¬íŠ¸ ì—°ê²° í•´ì œ"""
        if self.read_task:
            self.read_task.cancel()
            
        if self.serial and self.serial.is_open:
            self.serial.close()
            
        self.is_connected = False
        logger.info("Disconnected from serial port")
    
    async def _read_loop(self):
        """ì‹œë¦¬ì–¼ ë°ì´í„° ì½ê¸° ë£¨í”„"""
        while self.is_connected:
            try:
                if self.serial and self.serial.in_waiting:
                    line = self.serial.readline().decode('utf-8').strip()
                    if line:
                        await self._process_line(line)
                await asyncio.sleep(0.01)
            except Exception as e:
                logger.error(f"Read error: {e}")
                await asyncio.sleep(0.1)
    
    async def _process_line(self, line: str):
        """ìˆ˜ì‹ ëœ ë¼ì¸ ì²˜ë¦¬"""
        logger.debug(f"Received: {line}")
        
        # JSON ë°ì´í„° íŒŒì‹±
        if line.startswith('{') and line.endswith('}'):
            try:
                data = json.loads(line)
                await self._update_system_data(data)
                
                # ì½œë°± ì‹¤í–‰
                if 'data_update' in self.callbacks:
                    await self.callbacks['data_update'](self.system_data)
                    
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error: {e}")
        
        # OK ì‘ë‹µ ì²˜ë¦¬
        elif line.startswith('OK:'):
            response = line[3:]
            if 'command_response' in self.callbacks:
                await self.callbacks['command_response'](response)
        
        # ì—ëŸ¬ ì‘ë‹µ ì²˜ë¦¬
        elif line.startswith('Error:'):
            error = line[6:]
            if 'error' in self.callbacks:
                await self.callbacks['error'](error)
    
    async def _update_system_data(self, data: Dict[str, Any]):
        """ì‹œìŠ¤í…œ ë°ì´í„° ì—…ë°ì´íŠ¸"""
        if 'master' in data:
            self.system_data['master'].update(data['master'])
        
        if 'slaves' in data:
            self.system_data['slaves'] = data['slaves']
        
        if 'relays' in data:
            self.system_data['relays'] = data['relays']
        
        if 'relay_hex' in data:
            self.system_data['relay_hex'] = data['relay_hex']
        
        if 'water_running' in data:
            self.system_data['water_running'] = data['water_running']
    
    async def send_command(self, command: str) -> bool:
        """ëª…ë ¹ ì „ì†¡"""
        if not self.is_connected or not self.serial:
            return False
        
        try:
            self.serial.write(f"{command}\n".encode('utf-8'))
            logger.info(f"Sent command: {command}")
            return True
        except Exception as e:
            logger.error(f"Send error: {e}")
            return False
    
    async def set_relay(self, relay_num: int, state: bool) -> bool:
        """ë¦´ë ˆì´ ì œì–´"""
        command = f"R{relay_num}:{1 if state else 0}"
        return await self.send_command(command)
    
    async def set_all_relays(self, state: bool) -> bool:
        """ëª¨ë“  ë¦´ë ˆì´ ì œì–´"""
        command = "ON" if state else "OFF"
        return await self.send_command(command)
    
    async def set_water_config(self, delay_a: int, duration_b: int, cycles: int) -> bool:
        """ìžë™ ê¸‰ìˆ˜ ì„¤ì •"""
        command = f"WATER:{delay_a},{duration_b},{cycles}"
        return await self.send_command(command)
    
    async def control_water(self, action: str) -> bool:
        """ê¸‰ìˆ˜ ì œì–´"""
        if action == "start":
            return await self.send_command("WATER START")
        elif action == "stop":
            return await self.send_command("WATER STOP")
        return False
    
    def set_callback(self, event: str, callback: Callable):
        """ì½œë°± í•¨ìˆ˜ ë“±ë¡"""
        self.callbacks[event] = callback
    
    def get_status(self) -> Dict[str, Any]:
        """í˜„ìž¬ ìƒíƒœ ë°˜í™˜"""
        return {
            'connected': self.is_connected,
            'port': self.port,
            **self.system_data
        }