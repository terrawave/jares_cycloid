import sqlite3
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import json
from pathlib import Path

logger = logging.getLogger(__name__)

class DatabaseManager:
    """SQLite 데이터베이스 관리"""
    
    def __init__(self, db_path: str = "sensor_data.db"):
        self.db_path = db_path
        self.conn = None
        self.last_energy_value = None  # 마지막 누적전력량 저장
        self.last_energy_time = None   # 마지막 측정 시간
        self.init_database()
    
    def init_database(self):
        """데이터베이스 초기화 및 테이블 생성"""
        try:
            self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            cursor = self.conn.cursor()
            
            # 센서 데이터 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sensor_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    device TEXT NOT NULL,
                    temperature REAL,
                    humidity REAL,
                    co2 INTEGER,
                    lux REAL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 실시간 전력 데이터 테이블 (차트용)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS power_realtime (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    device TEXT NOT NULL,
                    voltage REAL,
                    current REAL,
                    power REAL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 시간별 전력 사용량 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS energy_hourly (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    hour INTEGER NOT NULL,
                    energy_kwh REAL NOT NULL,
                    avg_power REAL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(date, hour)
                )
            ''')
            
            # 일별 전력 사용량 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS energy_daily (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL UNIQUE,
                    energy_kwh REAL NOT NULL,
                    avg_power REAL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 월별 전력 사용량 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS energy_monthly (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    year INTEGER NOT NULL,
                    month INTEGER NOT NULL,
                    energy_kwh REAL NOT NULL,
                    avg_power REAL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(year, month)
                )
            ''')
            
            # 누적전력량 추적 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS energy_tracking (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    energy_value REAL NOT NULL
                )
            ''')
            
            # 릴레이 로그 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS relay_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    relay INTEGER NOT NULL,
                    action TEXT NOT NULL,
                    state TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 시스템 로그 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS system_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # 인덱스 생성
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_sensor_timestamp ON sensor_data(timestamp)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_sensor_device ON sensor_data(device)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_power_realtime_timestamp ON power_realtime(timestamp)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_energy_hourly_date ON energy_hourly(date, hour)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_energy_daily_date ON energy_daily(date)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_energy_monthly_year_month ON energy_monthly(year, month)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_relay_timestamp ON relay_logs(timestamp)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_system_timestamp ON system_logs(timestamp)')
            
            self.conn.commit()
            logger.info(f"Database initialized: {self.db_path}")
            
            # 마지막 누적전력량 값 로드
            self._load_last_energy_value()
            
        except Exception as e:
            logger.error(f"Database initialization failed: {e}")
            raise
    
    def _load_last_energy_value(self):
        """마지막 누적전력량 값 로드"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
                SELECT energy_value, timestamp FROM energy_tracking 
                ORDER BY timestamp DESC LIMIT 1
            ''')
            row = cursor.fetchone()
            if row:
                self.last_energy_value = row[0]
                self.last_energy_time = datetime.fromisoformat(row[1])
                logger.info(f"Loaded last energy value: {self.last_energy_value} kWh at {self.last_energy_time}")
        except Exception as e:
            logger.warning(f"Could not load last energy value: {e}")
    
    def save_energy_reading(self, energy_kwh: float, power_w: float = None):
        """
        누적전력량 읽기 및 사용량 계산
        
        Args:
            energy_kwh: 현재 누적전력량 (kWh)
            power_w: 현재 전력 (W)
        """
        try:
            now = datetime.now()
            cursor = self.conn.cursor()
            
            # 현재 누적값 저장
            cursor.execute('''
                INSERT INTO energy_tracking (timestamp, energy_value)
                VALUES (?, ?)
            ''', (now.isoformat(), energy_kwh))
            
            # 이전 값이 있으면 사용량 계산
            if self.last_energy_value is not None and self.last_energy_time is not None:
                # 사용량 계산 (kWh)
                energy_used = energy_kwh - self.last_energy_value
                
                # 음수 방지 (센서 리셋 등)
                if energy_used < 0:
                    energy_used = 0
                    logger.warning(f"Negative energy usage detected, resetting. Current: {energy_kwh}, Last: {self.last_energy_value}")
                
                # 시간 차이 계산
                time_diff = (now - self.last_energy_time).total_seconds() / 3600  # hours
                
                if time_diff > 0 and energy_used > 0:
                    # 시간별 저장
                    self._save_hourly_energy(now, energy_used, power_w)
                    
                    # 일별 누적
                    self._update_daily_energy(now.strftime('%Y-%m-%d'), energy_used, power_w)
                    
                    # 월별 누적
                    self._update_monthly_energy(now.year, now.month, energy_used, power_w)
            
            # 현재 값을 마지막 값으로 저장
            self.last_energy_value = energy_kwh
            self.last_energy_time = now
            
            self.conn.commit()
            
        except Exception as e:
            logger.error(f"Failed to save energy reading: {e}")
    
    def _save_hourly_energy(self, timestamp: datetime, energy_kwh: float, power_w: float = None):
        """시간별 전력 사용량 저장"""
        try:
            cursor = self.conn.cursor()
            date_str = timestamp.strftime('%Y-%m-%d')
            hour = timestamp.hour
            
            cursor.execute('''
                INSERT INTO energy_hourly (date, hour, energy_kwh, avg_power)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(date, hour) 
                DO UPDATE SET 
                    energy_kwh = energy_kwh + excluded.energy_kwh,
                    avg_power = CASE 
                        WHEN excluded.avg_power IS NOT NULL 
                        THEN (COALESCE(avg_power, 0) + excluded.avg_power) / 2 
                        ELSE avg_power 
                    END
            ''', (date_str, hour, energy_kwh, power_w))
            
        except Exception as e:
            logger.error(f"Failed to save hourly energy: {e}")
    
    def _update_daily_energy(self, date_str: str, energy_kwh: float, power_w: float = None):
        """일별 전력 사용량 업데이트"""
        try:
            cursor = self.conn.cursor()
            
            cursor.execute('''
                INSERT INTO energy_daily (date, energy_kwh, avg_power)
                VALUES (?, ?, ?)
                ON CONFLICT(date) 
                DO UPDATE SET 
                    energy_kwh = energy_kwh + excluded.energy_kwh,
                    avg_power = CASE 
                        WHEN excluded.avg_power IS NOT NULL 
                        THEN (COALESCE(avg_power, 0) + excluded.avg_power) / 2 
                        ELSE avg_power 
                    END
            ''', (date_str, energy_kwh, power_w))
            
        except Exception as e:
            logger.error(f"Failed to update daily energy: {e}")
    
    def _update_monthly_energy(self, year: int, month: int, energy_kwh: float, power_w: float = None):
        """월별 전력 사용량 업데이트"""
        try:
            cursor = self.conn.cursor()
            
            cursor.execute('''
                INSERT INTO energy_monthly (year, month, energy_kwh, avg_power)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(year, month) 
                DO UPDATE SET 
                    energy_kwh = energy_kwh + excluded.energy_kwh,
                    avg_power = CASE 
                        WHEN excluded.avg_power IS NOT NULL 
                        THEN (COALESCE(avg_power, 0) + excluded.avg_power) / 2 
                        ELSE avg_power 
                    END
            ''', (year, month, energy_kwh, power_w))
            
        except Exception as e:
            logger.error(f"Failed to update monthly energy: {e}")
    
    def save_sensor_data(self, device: str, temperature: float = None, 
                        humidity: float = None, co2: int = None, lux: float = None):
        """센서 데이터 저장"""
        try:
            cursor = self.conn.cursor()
            timestamp = datetime.now().isoformat()
            
            cursor.execute('''
                INSERT INTO sensor_data (timestamp, device, temperature, humidity, co2, lux)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (timestamp, device, temperature, humidity, co2, lux))
            
            self.conn.commit()
            return cursor.lastrowid
            
        except Exception as e:
            logger.error(f"Failed to save sensor data: {e}")
            return None
    
    def save_power_realtime(self, device: str, voltage: float = None, 
                           current: float = None, power: float = None):
        """실시간 전력 데이터 저장 (차트용)"""
        try:
            cursor = self.conn.cursor()
            timestamp = datetime.now().isoformat()
            
            cursor.execute('''
                INSERT INTO power_realtime (timestamp, device, voltage, current, power)
                VALUES (?, ?, ?, ?, ?)
            ''', (timestamp, device, voltage, current, power))
            
            self.conn.commit()
            return cursor.lastrowid
            
        except Exception as e:
            logger.error(f"Failed to save power realtime: {e}")
            return None
    
    def save_relay_log(self, relay: int, action: str, state: str):
        """릴레이 로그 저장"""
        try:
            cursor = self.conn.cursor()
            timestamp = datetime.now().isoformat()
            
            cursor.execute('''
                INSERT INTO relay_logs (timestamp, relay, action, state)
                VALUES (?, ?, ?, ?)
            ''', (timestamp, relay, action, state))
            
            self.conn.commit()
            return cursor.lastrowid
            
        except Exception as e:
            logger.error(f"Failed to save relay log: {e}")
            return None
    
    def save_system_log(self, log_type: str, message: str):
        """시스템 로그 저장"""
        try:
            cursor = self.conn.cursor()
            timestamp = datetime.now().isoformat()
            
            cursor.execute('''
                INSERT INTO system_logs (timestamp, type, message)
                VALUES (?, ?, ?)
            ''', (timestamp, log_type, message))
            
            self.conn.commit()
            return cursor.lastrowid
            
        except Exception as e:
            logger.error(f"Failed to save system log: {e}")
            return None
    
    # ========== 조회 메서드 ==========
    
    def get_sensor_data(self, limit: int = 100, offset: int = 0, device: str = None):
        """센서 데이터 조회"""
        try:
            cursor = self.conn.cursor()
            
            if device:
                cursor.execute('''
                    SELECT * FROM sensor_data 
                    WHERE device = ?
                    ORDER BY created_at DESC 
                    LIMIT ? OFFSET ?
                ''', (device, limit, offset))
            else:
                cursor.execute('''
                    SELECT * FROM sensor_data 
                    ORDER BY created_at DESC 
                    LIMIT ? OFFSET ?
                ''', (limit, offset))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get sensor data: {e}")
            return []
    
    def get_power_realtime(self, limit: int = 100, offset: int = 0):
        """실시간 전력 데이터 조회"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
                SELECT * FROM power_realtime 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            ''', (limit, offset))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get power realtime: {e}")
            return []
    
    def get_energy_hourly(self, date: str = None, limit: int = 24):
        """시간별 전력 사용량 조회"""
        try:
            cursor = self.conn.cursor()
            
            if date:
                cursor.execute('''
                    SELECT * FROM energy_hourly 
                    WHERE date = ?
                    ORDER BY hour
                ''', (date,))
            else:
                # 최근 24시간
                cursor.execute('''
                    SELECT * FROM energy_hourly 
                    ORDER BY date DESC, hour DESC 
                    LIMIT ?
                ''', (limit,))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get hourly energy: {e}")
            return []
    
    def get_energy_daily(self, start_date: str = None, end_date: str = None, limit: int = 30):
        """일별 전력 사용량 조회"""
        try:
            cursor = self.conn.cursor()
            
            if start_date and end_date:
                cursor.execute('''
                    SELECT * FROM energy_daily 
                    WHERE date BETWEEN ? AND ?
                    ORDER BY date DESC
                ''', (start_date, end_date))
            else:
                cursor.execute('''
                    SELECT * FROM energy_daily 
                    ORDER BY date DESC 
                    LIMIT ?
                ''', (limit,))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get daily energy: {e}")
            return []
    
    def get_energy_monthly(self, year: int = None, limit: int = 12):
        """월별 전력 사용량 조회"""
        try:
            cursor = self.conn.cursor()
            
            if year:
                cursor.execute('''
                    SELECT * FROM energy_monthly 
                    WHERE year = ?
                    ORDER BY month
                ''', (year,))
            else:
                cursor.execute('''
                    SELECT * FROM energy_monthly 
                    ORDER BY year DESC, month DESC 
                    LIMIT ?
                ''', (limit,))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get monthly energy: {e}")
            return []
    
    def get_relay_logs(self, limit: int = 100, offset: int = 0):
        """릴레이 로그 조회"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
                SELECT * FROM relay_logs 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            ''', (limit, offset))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get relay logs: {e}")
            return []
    
    def get_system_logs(self, limit: int = 100, offset: int = 0):
        """시스템 로그 조회"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('''
                SELECT * FROM system_logs 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            ''', (limit, offset))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get system logs: {e}")
            return []
    
    def get_sensor_data_by_period(self, start_date: str, end_date: str, device: str = None):
        """기간별 센서 데이터 조회"""
        try:
            cursor = self.conn.cursor()
            
            if device:
                cursor.execute('''
                    SELECT * FROM sensor_data 
                    WHERE timestamp BETWEEN ? AND ?
                    AND device = ?
                    ORDER BY timestamp DESC
                ''', (start_date, end_date, device))
            else:
                cursor.execute('''
                    SELECT * FROM sensor_data 
                    WHERE timestamp BETWEEN ? AND ?
                    ORDER BY timestamp DESC
                ''', (start_date, end_date))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get sensor data by period: {e}")
            return []
    
    # ========== 통계 메서드 ==========
    
    def get_sensor_count(self):
        """센서 데이터 개수 조회"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('SELECT COUNT(*) as count FROM sensor_data')
            result = cursor.fetchone()
            return result['count'] if result else 0
        except Exception as e:
            logger.error(f"Failed to get sensor count: {e}")
            return 0
    
    def get_relay_log_count(self):
        """릴레이 로그 개수 조회"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('SELECT COUNT(*) as count FROM relay_logs')
            result = cursor.fetchone()
            return result['count'] if result else 0
        except Exception as e:
            logger.error(f"Failed to get relay log count: {e}")
            return 0
    
    def get_system_log_count(self):
        """시스템 로그 개수 조회"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('SELECT COUNT(*) as count FROM system_logs')
            result = cursor.fetchone()
            return result['count'] if result else 0
        except Exception as e:
            logger.error(f"Failed to get system log count: {e}")
            return 0
    
    # ========== 삭제 메서드 ==========
    
    def clear_sensor_data(self):
        """센서 데이터 삭제"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('DELETE FROM sensor_data')
            self.conn.commit()
            logger.info("Sensor data cleared")
            return True
        except Exception as e:
            logger.error(f"Failed to clear sensor data: {e}")
            return False
    
    def clear_power_realtime(self):
        """실시간 전력 데이터 삭제"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('DELETE FROM power_realtime')
            self.conn.commit()
            logger.info("Power realtime data cleared")
            return True
        except Exception as e:
            logger.error(f"Failed to clear power realtime: {e}")
            return False
    
    def clear_relay_logs(self):
        """릴레이 로그 삭제"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('DELETE FROM relay_logs')
            self.conn.commit()
            logger.info("Relay logs cleared")
            return True
        except Exception as e:
            logger.error(f"Failed to clear relay logs: {e}")
            return False
    
    def clear_system_logs(self):
        """시스템 로그 삭제"""
        try:
            cursor = self.conn.cursor()
            cursor.execute('DELETE FROM system_logs')
            self.conn.commit()
            logger.info("System logs cleared")
            return True
        except Exception as e:
            logger.error(f"Failed to clear system logs: {e}")
            return False
    
    def close(self):
        """데이터베이스 연결 종료"""
        if self.conn:
            self.conn.close()
            logger.info("Database connection closed")