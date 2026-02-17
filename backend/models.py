from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum

class RelayCommand(BaseModel):
    relay_number: int
    state: bool

class RelayBulkCommand(BaseModel):
    states: List[bool]

class WaterConfig(BaseModel):
    delay_a: int  # 센서 감지 후 대기 시간 (초)
    duration_b: int  # 급수 시간 (초)
    cycle_count: int  # 반복 횟수

class WaterCommand(BaseModel):
    action: str  # "start", "stop", "config"
    config: Optional[WaterConfig] = None

class SensorData(BaseModel):
    device_name: str
    temperature: float
    humidity: float
    co2: int
    lux: float
    timestamp: datetime
    mac_address: str

class SystemStatus(BaseModel):
    connected: bool
    serial_port: str
    relays: List[bool]
    relay_hex: str
    master_power: Dict[str, float]
    slaves: List[SensorData]
    water_status: Dict[str, Any]
    last_update: datetime

class Schedule(BaseModel):
    id: Optional[int] = None
    name: str
    enabled: bool
    time: str  # "HH:MM"
    days: List[int]  # [0=Mon, 1=Tue, ..., 6=Sun]
    relay_states: List[bool]
    water_config: Optional[WaterConfig] = None

class LogEntry(BaseModel):
    timestamp: datetime
    level: str
    message: str
    data: Optional[Dict[str, Any]] = None