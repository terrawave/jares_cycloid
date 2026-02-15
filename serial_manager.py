import asyncio
import serial
import serial.tools.list_ports
from serial import Serial
import json
import logging
from typing import Optional, Dict, Any, Callable, List
from datetime import datetime
import re
import os
from collections import deque

logger = logging.getLogger(__name__)

CONFIG_FILE = 'auto_config.json'

class SerialManager:
    def __init__(self, port: str = None, baudrate: int = 115200):
        self.port = port
        self.baudrate = baudrate
        self.serial: Optional[Serial] = None
        self.is_connected = False
        self.read_task: Optional[asyncio.Task] = None
        self.reconnect_task: Optional[asyncio.Task] = None
        self.callbacks: Dict[str, Callable] = {}
        self.command_queue = deque()
        self.command_lock = asyncio.Lock()
        self.buffer = ""  # 부분 수신 데이터 버퍼
        self.reconnect_enabled = True
        self.reconnect_interval = 5  # 재연결 시도 간격 (초)
        self.max_reconnect_attempts = 0  # 0 = 무한 재시도
        self.reconnect_attempts = 0
        
        self.system_data = {
            'relays': [False] * 16,
            'relay_hex': '0x0000',
            'master': {
                'voltage': 0.0,
                'current': 0.0,
                'power': 0.0,
                'energy': 0.0,
                'frequency': 0.0,
                'pf': 0.0,
                'motor_adc': 0,
                'proximity': False
            },
            'slaves': [],
            'water_running': False,
            'drain_running': False,
            'drain_progress': {
                'current_cycle': 0,
                'total_cycles': 0,
                'phase': 'idle',  # idle, motor_running, delay, draining
                'phase_remaining': 0
            },
            'last_update': None
        }

        # 자동 급수/배수 설정 로드
        self._load_config()
        self.drain_task: Optional[asyncio.Task] = None

        # 릴레이 번호 정의
        self.RELAY_SPEED1 = 0
        self.RELAY_SPEED2 = 1
        self.RELAY_SPEED3 = 2
        self.RELAY_DRAIN_VALVE = 3
        self.RELAY_WATER_VALVE = 4
        self.RELAY_FORWARD = 8
        self.RELAY_REVERSE = 9

    def _load_config(self):
        """파일에서 급수/배수 설정 로드"""
        default_water = {'delay': 5, 'duration': 10, 'cycles': 81}
        default_drain = {'delay': 5, 'duration': 10, 'cycles': 81}

        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r') as f:
                    config = json.load(f)
                    self.water_config = config.get('water', default_water)
                    self.drain_config = config.get('drain', default_drain)
                    logger.info(f"Config loaded - Water: {self.water_config}, Drain: {self.drain_config}")
                    return
        except Exception as e:
            logger.error(f"Failed to load config: {e}")

        self.water_config = default_water
        self.drain_config = default_drain

    def _save_config(self):
        """파일에 급수/배수 설정 저장"""
        try:
            config = {
                'water': self.water_config,
                'drain': self.drain_config
            }
            with open(CONFIG_FILE, 'w') as f:
                json.dump(config, f, indent=2)
            logger.info(f"Config saved - Water: {self.water_config}, Drain: {self.drain_config}")
        except Exception as e:
            logger.error(f"Failed to save config: {e}")

    def auto_detect_port(self) -> Optional[str]:
        """USB-TTL 포트 자동 감지"""
        patterns = ['usbserial', 'usbmodem', 'SLAB_USBtoUART', 'wchusbserial', 'ttyUSB', 'ttyACM']
        
        ports = serial.tools.list_ports.comports()
        for port in ports:
            logger.info(f"Found port: {port.device} - {port.description}")
            for pattern in patterns:
                if pattern.lower() in port.device.lower() or pattern.lower() in port.description.lower():
                    logger.info(f"Auto-detected serial port: {port.device}")
                    return port.device
        
        logger.warning("No USB-TTL device found")
        return None
    
    async def connect(self, auto_reconnect: bool = True) -> bool:
        """시리얼 포트 연결"""
        try:
            # 포트가 지정되지 않았으면 자동 감지
            if not self.port:
                self.port = self.auto_detect_port()
                if not self.port:
                    raise Exception("No serial port found")
            
            # 기존 연결이 있으면 닫기
            if self.serial and self.serial.is_open:
                try:
                    self.serial.close()
                except:
                    pass
            
            # 새 연결 생성
            self.serial = Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=1.0,  # 타임아웃 증가
                write_timeout=1.0
            )
            
            self.is_connected = True
            self.reconnect_attempts = 0
            self.buffer = ""
            
            # 읽기 태스크 시작
            if self.read_task:
                self.read_task.cancel()
            self.read_task = asyncio.create_task(self._read_loop())
            
            # 자동 재연결 활성화
            if auto_reconnect and self.reconnect_enabled:
                if self.reconnect_task:
                    self.reconnect_task.cancel()
                self.reconnect_task = asyncio.create_task(self._monitor_connection())
            
            # 초기 상태 요청
            await asyncio.sleep(2)
            await self.send_command("JSON")
            
            logger.info(f"✅ Connected to {self.port} at {self.baudrate} baud")
            
            # 연결 성공 콜백
            if 'connected' in self.callbacks:
                try:
                    await self.callbacks['connected']()
                except Exception as e:
                    logger.error(f"Callback error: {e}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to connect: {e}")
            self.is_connected = False
            return False
    
    async def disconnect(self, disable_reconnect: bool = True):
        """시리얼 포트 연결 해제"""
        if disable_reconnect:
            self.reconnect_enabled = False
        
        # 재연결 태스크 중지
        if self.reconnect_task:
            self.reconnect_task.cancel()
            try:
                await self.reconnect_task
            except asyncio.CancelledError:
                pass
        
        # 읽기 태스크 중지
        if self.read_task:
            self.read_task.cancel()
            try:
                await self.read_task
            except asyncio.CancelledError:
                pass
        
        # 시리얼 포트 닫기
        if self.serial:
            try:
                if self.serial.is_open:
                    self.serial.close()
            except Exception as e:
                logger.error(f"Error closing serial port: {e}")
        
        self.is_connected = False
        logger.info("🔌 Disconnected from serial port")
        
        # 연결 해제 콜백
        if 'disconnected' in self.callbacks:
            try:
                await self.callbacks['disconnected']()
            except Exception as e:
                logger.error(f"Callback error: {e}")
    
    async def _monitor_connection(self):
        """연결 상태 모니터링 및 재연결"""
        while self.reconnect_enabled:
            try:
                await asyncio.sleep(self.reconnect_interval)
                
                # 연결 상태 확인
                if not self.is_connected or not self.serial or not self.serial.is_open:
                    logger.warning("⚠️ Connection lost, attempting to reconnect...")
                    
                    if self.max_reconnect_attempts > 0 and self.reconnect_attempts >= self.max_reconnect_attempts:
                        logger.error("❌ Max reconnection attempts reached")
                        break
                    
                    self.reconnect_attempts += 1
                    await self.connect(auto_reconnect=False)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Reconnection error: {e}")
    
    async def _read_loop(self):
        """시리얼 데이터 읽기 루프"""
        while self.is_connected:
            try:
                if self.serial and self.serial.is_open and self.serial.in_waiting:
                    # 데이터 읽기
                    chunk = self.serial.read(self.serial.in_waiting).decode('utf-8', errors='ignore')
                    self.buffer += chunk
                    
                    # 완성된 라인 처리
                    while '\n' in self.buffer:
                        line, self.buffer = self.buffer.split('\n', 1)
                        line = line.strip()
                        if line:
                            await self._process_line(line)
                else:
                    # 데이터가 없으면 잠시 대기
                    await asyncio.sleep(0.01)
                    
            except serial.SerialException as e:
                logger.error(f"Serial error: {e}")
                self.is_connected = False
                break
            except Exception as e:
                logger.error(f"Read error: {e}")
                await asyncio.sleep(0.1)
    
    async def _process_line(self, line: str):
        """수신된 라인 처리"""
        logger.debug(f"📥 Received: {line}")
        
        # JSON 데이터 파싱
        if line.startswith('{') and line.endswith('}'):
            try:
                data = json.loads(line)
                await self._update_system_data(data)
                
                # 콜백 실행
                if 'data_update' in self.callbacks:
                    try:
                        await self.callbacks['data_update'](self.system_data)
                    except Exception as e:
                        logger.error(f"Callback error in data_update: {e}")
                        
            except json.JSONDecodeError as e:
                # JSON 파싱 에러 - 손상된 데이터 무시
                logger.warning(f"⚠️ Corrupted JSON ignored (serial data loss)")
                logger.debug(f"Parse error: {str(e)[:80]}")
                logger.debug(f"Line: {line[:150]}...")
        
        # OK 응답 처리
        elif line.startswith('OK:'):
            response = line[3:]
            logger.info(f"✅ Command OK: {response}")
            if 'command_response' in self.callbacks:
                try:
                    await self.callbacks['command_response'](response)
                except Exception as e:
                    logger.error(f"Callback error in command_response: {e}")
        
        # Error 응답 처리
        elif line.startswith('Error:'):
            error = line[6:]
            logger.error(f"❌ Command Error: {error}")
            if 'error' in self.callbacks:
                try:
                    await self.callbacks['error'](error)
                except Exception as e:
                    logger.error(f"Callback error in error handler: {e}")
        
        # 일반 로그 메시지 처리
        else:
            if 'log' in self.callbacks:
                try:
                    await self.callbacks['log'](line)
                except Exception as e:
                    logger.error(f"Callback error in log: {e}")
    
    async def _update_system_data(self, data: Dict[str, Any]):
        """시스템 데이터 업데이트"""
        try:
            if 'master' in data:
                master_data = data['master']
                # proximity를 boolean으로 변환
                if 'proximity' in master_data:
                    master_data['proximity'] = bool(master_data['proximity'])
                self.system_data['master'].update(master_data)
            
            if 'slaves' in data:
                self.system_data['slaves'] = data['slaves']
            
            if 'relays' in data:
                # relays 배열을 boolean 리스트로 변환
                self.system_data['relays'] = [bool(r) for r in data['relays']]
            
            if 'relay_hex' in data:
                self.system_data['relay_hex'] = data['relay_hex']
            
            if 'water_running' in data:
                # water_running을 boolean으로 변환
                self.system_data['water_running'] = bool(data['water_running'])
            
            # 마지막 업데이트 시간 기록
            self.system_data['last_update'] = datetime.now()
            
        except Exception as e:
            logger.error(f"Error updating system data: {e}")
    
    async def send_command(self, command: str, priority: bool = False) -> bool:
        """명령 전송 (큐 사용)"""
        if not self.is_connected or not self.serial:
            logger.warning(f"⚠️ Cannot send command (not connected): {command}")
            return False
        
        async with self.command_lock:
            try:
                if priority:
                    self.command_queue.appendleft(command)
                else:
                    self.command_queue.append(command)
                
                # 큐에서 명령 꺼내서 전송
                if self.command_queue:
                    cmd = self.command_queue.popleft()
                    self.serial.write(f"{cmd}\n".encode('utf-8'))
                    self.serial.flush()
                    logger.info(f"📤 Sent command: {cmd}")
                    await asyncio.sleep(0.05)  # 명령 간 간격
                    return True
                    
            except serial.SerialException as e:
                logger.error(f"Serial error while sending: {e}")
                self.is_connected = False
                return False
            except Exception as e:
                logger.error(f"Send error: {e}")
                return False
        
        return False
    
    async def send_command_wait(self, command: str, timeout: float = 2.0) -> Optional[str]:
        """명령 전송 후 응답 대기"""
        response_future = asyncio.Future()
        
        async def response_handler(response: str):
            if not response_future.done():
                response_future.set_result(response)
        
        # 임시 콜백 등록
        original_callback = self.callbacks.get('command_response')
        self.callbacks['command_response'] = response_handler
        
        try:
            # 명령 전송
            if not await self.send_command(command, priority=True):
                return None
            
            # 응답 대기
            response = await asyncio.wait_for(response_future, timeout=timeout)
            return response
            
        except asyncio.TimeoutError:
            logger.warning(f"⏱️ Command timeout: {command}")
            return None
        finally:
            # 원래 콜백 복원
            if original_callback:
                self.callbacks['command_response'] = original_callback
            else:
                self.callbacks.pop('command_response', None)
    
    async def set_relay(self, relay_num: int, state: bool) -> bool:
        """릴레이 제어"""
        if not 0 <= relay_num <= 15:
            logger.error(f"Invalid relay number: {relay_num}")
            return False

        command = f"R{relay_num}:{1 if state else 0}"
        result = await self.send_command(command)

        # UI 동기화를 위해 system_data도 업데이트
        if result and 'relays' in self.system_data:
            self.system_data['relays'][relay_num] = state
            # WebSocket으로 브로드캐스트
            if 'data_update' in self.callbacks:
                try:
                    await self.callbacks['data_update'](self.system_data)
                except Exception as e:
                    logger.error(f"Callback error in set_relay: {e}")

        return result
    
    async def set_all_relays(self, state: bool) -> bool:
        """모든 릴레이 제어"""
        command = "ON" if state else "OFF"
        return await self.send_command(command)

    async def set_motor_speed(self, speed: int) -> bool:
        """모터 속도 설정 (0=정지, 1/2/3=속도) - 배타적 선택"""
        await self.set_relay(self.RELAY_SPEED1, speed == 1)
        await self.set_relay(self.RELAY_SPEED2, speed == 2)
        await self.set_relay(self.RELAY_SPEED3, speed == 3)
        logger.info(f"Motor speed set to: {speed}")
        return True

    async def set_motor_direction(self, direction: int) -> bool:
        """모터 방향 설정 (0=정지, 1=정회전, 2=역회전) - 배타적 선택"""
        await self.set_relay(self.RELAY_FORWARD, direction == 1)
        await self.set_relay(self.RELAY_REVERSE, direction == 2)
        dir_name = {0: 'STOP', 1: 'FORWARD', 2: 'REVERSE'}.get(direction, 'UNKNOWN')
        logger.info(f"Motor direction set to: {dir_name}")
        return True

    async def stop_motor(self) -> bool:
        """모터 정지"""
        await self.set_motor_speed(0)
        await self.set_motor_direction(0)
        logger.info("Motor stopped")
        return True

    async def set_water_config(self, delay_a: int, duration_b: int, cycles: int) -> bool:
        """자동 급수 설정"""
        if delay_a <= 0 or duration_b <= 0 or cycles <= 0:
            logger.error("Invalid water config parameters")
            return False

        # 서버에 설정 저장
        self.water_config = {
            'delay': delay_a,
            'duration': duration_b,
            'cycles': cycles
        }
        self._save_config()

        # 펌웨어에도 전송
        command = f"WATER:{delay_a},{duration_b},{cycles}"
        return await self.send_command(command)
    
    async def control_water(self, action: str) -> bool:
        """급수 제어"""
        if action.lower() == "start":
            return await self.send_command("WATER START")
        elif action.lower() == "stop":
            return await self.send_command("WATER STOP")
        elif action.lower() == "status":
            return await self.send_command("WATER STATUS")
        else:
            logger.error(f"Invalid water action: {action}")
            return False

    async def set_drain_config(self, delay_a: int, duration_b: int, cycles: int) -> bool:
        """자동 배수 설정 (서버단 구현)"""
        if delay_a <= 0 or duration_b <= 0 or cycles <= 0:
            logger.error("Invalid drain config parameters")
            return False

        self.drain_config = {
            'delay': delay_a,
            'duration': duration_b,
            'cycles': cycles
        }
        self._save_config()  # 파일에 저장
        logger.info(f"Drain config set: delay={delay_a}s, duration={duration_b}s, cycles={cycles}")
        return True

    async def _update_drain_progress_async(self, cycle: int, total: int, phase: str, remaining: int = 0):
        """배수 진행 상황 업데이트 + 브로드캐스트"""
        self.system_data['drain_progress'] = {
            'current_cycle': cycle,
            'total_cycles': total,
            'phase': phase,
            'phase_remaining': remaining
        }
        await self._broadcast_status()

    def _update_drain_progress(self, cycle: int, total: int, phase: str, remaining: int = 0):
        """배수 진행 상황 업데이트 (동기)"""
        self.system_data['drain_progress'] = {
            'current_cycle': cycle,
            'total_cycles': total,
            'phase': phase,
            'phase_remaining': remaining
        }

    async def _sleep_with_countdown(self, seconds: int, cycle: int, total: int, phase: str):
        """카운트다운과 함께 대기"""
        for remaining in range(seconds, 0, -1):
            if not self.system_data['drain_running']:
                break
            await self._update_drain_progress_async(cycle, total, phase, remaining)
            await asyncio.sleep(1)

    async def _wait_for_sensor_ready(self, cycle: int, total: int) -> bool:
        """미감지 상태가 1초 이상 유지될 때까지 대기"""
        undetected_start = None
        last_broadcast = 0

        while self.system_data['drain_running']:
            proximity = self.system_data.get('master', {}).get('proximity', False)
            now = asyncio.get_event_loop().time()

            # 0.5초마다 브로드캐스트
            if now - last_broadcast >= 0.5:
                await self._update_drain_progress_async(cycle, total, 'waiting_undetected', 0)
                last_broadcast = now

            if not proximity:  # 미감지
                if undetected_start is None:
                    undetected_start = now
                elif now - undetected_start >= 1.0:
                    # 1초 이상 미감지 유지됨 → 준비 완료
                    logger.info(f"Drain cycle {cycle}/{total}: sensor ready (undetected for 1s+)")
                    return True
            else:  # 감지됨 → 타이머 리셋
                undetected_start = None

            await asyncio.sleep(0.1)

        return False

    async def _wait_for_sensor_detected(self, cycle: int, total: int, delay: int) -> bool:
        """감지 상태가 delay 시간 동안 유지되는지 확인"""
        detected_start = None
        last_broadcast = 0

        while self.system_data['drain_running']:
            proximity = self.system_data.get('master', {}).get('proximity', False)
            now = asyncio.get_event_loop().time()

            if proximity:  # 감지됨
                if detected_start is None:
                    detected_start = now
                    logger.info(f"Drain cycle {cycle}/{total}: sensor detected, checking {delay}s hold...")
                    # 감지 즉시 브로드캐스트
                    await self._update_drain_progress_async(cycle, total, 'delay', delay)

                elapsed = now - detected_start
                remaining = max(0, delay - int(elapsed))
                await self._update_drain_progress_async(cycle, total, 'delay', remaining)

                if elapsed >= delay:
                    # delay 시간 동안 감지 유지됨 → 성공
                    logger.info(f"Drain cycle {cycle}/{total}: sensor held for {delay}s, proceeding!")
                    return True
            else:  # 감지 안됨
                if detected_start is not None:
                    # 감지 중에 풀림 → 처음부터 다시
                    logger.info(f"Drain cycle {cycle}/{total}: sensor released, restarting...")
                    await self._update_drain_progress_async(cycle, total, 'waiting_undetected', 0)
                    return False
                # 아직 감지 안됨 → 계속 대기 (0.5초마다 브로드캐스트)
                if now - last_broadcast >= 0.5:
                    await self._update_drain_progress_async(cycle, total, 'waiting_sensor', 0)
                    last_broadcast = now

            await asyncio.sleep(0.1)

        return False

    async def _wait_for_sensor(self, cycle: int, total: int, delay: int) -> bool:
        """센서 감지 로직: 미감지 1초 유지 → 감지 후 delay 유지"""
        while self.system_data['drain_running']:
            # 1단계: 미감지 1초 이상 유지 대기
            await self._update_drain_progress_async(cycle, total, 'waiting_undetected', 0)
            ready = await self._wait_for_sensor_ready(cycle, total)
            if not ready:
                return False

            # 2단계: 감지 후 delay 시간 유지 확인
            await self._update_drain_progress_async(cycle, total, 'waiting_sensor', 0)
            logger.info(f"Drain cycle {cycle}/{total}: waiting for sensor detection...")

            detected = await self._wait_for_sensor_detected(cycle, total, delay)
            if detected:
                return True
            # 감지 중 풀리면 다시 1단계부터

        return False

    async def _drain_cycle(self):
        """자동 배수 사이클 실행 (서버단 구현)"""
        try:
            delay = self.drain_config['delay']
            duration = self.drain_config['duration']
            cycles = self.drain_config['cycles']

            logger.info(f"Starting drain cycle: delay={delay}s, duration={duration}s, cycles={cycles}")

            # 시작: 정회전 + 속도1
            await self.set_motor_direction(1)  # 정회전
            await self.set_motor_speed(1)      # 속도1
            logger.info("Motor started: Forward + Speed1")

            for i in range(cycles):
                if not self.system_data['drain_running']:
                    break

                # 1. 센서 감지 로직: 미감지 1초 유지 → 감지 후 delay 유지
                sensor_ok = await self._wait_for_sensor(i + 1, cycles, delay)
                if not sensor_ok:
                    break

                # 2. 배수 시작: 모터 정지, 배수밸브 ON
                await self._update_drain_progress_async(i + 1, cycles, 'draining', duration)
                logger.info(f"Drain cycle {i+1}/{cycles}: draining for {duration}s")
                await self.set_motor_direction(0)  # 모터 정지
                await self.set_relay(self.RELAY_DRAIN_VALVE, True)
                await self._sleep_with_countdown(duration, i + 1, cycles, 'draining')

                # 4. 배수 완료: 배수밸브 OFF, 다음 사이클 준비
                await self.set_relay(self.RELAY_DRAIN_VALVE, False)

                if i < cycles - 1:
                    # 다음 사이클을 위해 모터 재시작
                    await self._update_drain_progress_async(i + 1, cycles, 'motor_running', 0)
                    await self.set_motor_direction(1)  # 정회전
                    await self.set_motor_speed(1)      # 속도1

            # 완료 후 모터 유지 (정회전 + 속도1)
            await self.set_motor_direction(1)
            await self.set_motor_speed(1)
            self.system_data['drain_running'] = False
            await self._update_drain_progress_async(0, 0, 'idle', 0)
            logger.info("Drain cycle completed")

        except asyncio.CancelledError:
            await self.set_relay(self.RELAY_DRAIN_VALVE, False)
            await self.stop_motor()
            self.system_data['drain_running'] = False
            await self._update_drain_progress_async(0, 0, 'idle', 0)
            logger.info("Drain cycle cancelled")
        except Exception as e:
            await self.set_relay(self.RELAY_DRAIN_VALVE, False)
            await self.stop_motor()
            self.system_data['drain_running'] = False
            await self._update_drain_progress_async(0, 0, 'idle', 0)
            logger.error(f"Drain cycle error: {e}")

    async def _broadcast_status(self):
        """현재 상태를 WebSocket으로 브로드캐스트"""
        if 'data_update' in self.callbacks:
            try:
                await self.callbacks['data_update'](self.system_data)
            except Exception as e:
                logger.error(f"Broadcast error: {e}")

    async def control_drain(self, action: str) -> bool:
        """배수 제어 (서버단 구현)"""
        if action.lower() == "start":
            if self.system_data['drain_running']:
                logger.warning("Drain already running")
                return False

            # 급수 중이면 먼저 중지
            if self.system_data.get('water_running', False):
                logger.info("Stopping water before starting drain")
                await self.send_command("WATER STOP")
                self.system_data['water_running'] = False

            self.system_data['drain_running'] = True
            # 시작 즉시 진행 상황 표시
            await self._update_drain_progress_async(1, self.drain_config['cycles'], 'starting', 0)
            self.drain_task = asyncio.create_task(self._drain_cycle())
            logger.info("Drain started")
            return True

        elif action.lower() == "stop":
            self.system_data['drain_running'] = False
            await self._update_drain_progress_async(0, 0, 'idle', 0)
            if self.drain_task and not self.drain_task.done():
                self.drain_task.cancel()
            await self.set_relay(self.RELAY_DRAIN_VALVE, False)
            await self.stop_motor()
            await self._broadcast_status()  # 즉시 브로드캐스트
            logger.info("Drain stopped")
            return True

        elif action.lower() == "status":
            return self.system_data['drain_running']

        else:
            logger.error(f"Invalid drain action: {action}")
            return False

    async def request_status(self) -> bool:
        """상태 요청"""
        return await self.send_command("STATUS")
    
    async def request_json(self) -> bool:
        """JSON 데이터 요청"""
        return await self.send_command("JSON")
    
    async def enable_monitor(self, interval_ms: int = 1000) -> bool:
        """모니터 모드 활성화"""
        command = f"MONITOR:{interval_ms}"
        return await self.send_command(command)
    
    async def disable_monitor(self) -> bool:
        """모니터 모드 비활성화"""
        return await self.send_command("MONITOR:0")
    
    def set_callback(self, event: str, callback: Callable):
        """콜백 함수 등록
        
        Available events:
        - connected: 연결 성공시
        - disconnected: 연결 해제시
        - data_update: 데이터 업데이트시
        - command_response: 명령 응답시
        - error: 에러 발생시
        - log: 일반 로그 메시지
        """
        self.callbacks[event] = callback
        logger.debug(f"Callback registered for event: {event}")
    
    def remove_callback(self, event: str):
        """콜백 함수 제거"""
        if event in self.callbacks:
            del self.callbacks[event]
            logger.debug(f"Callback removed for event: {event}")
    
    def get_status(self) -> Dict[str, Any]:
        """현재 상태 반환 (JSON 직렬화 가능)"""
        status_data = {
            'connected': self.is_connected,
            'port': self.port,
            'baudrate': self.baudrate,
            'reconnect_attempts': self.reconnect_attempts,
            **self.system_data
        }
        
        # datetime 객체를 ISO 형식 문자열로 변환
        if 'last_update' in status_data and status_data['last_update']:
            status_data['last_update'] = status_data['last_update'].isoformat()
        
        return status_data
    
    def get_relay_state(self, relay_num: int) -> Optional[bool]:
        """특정 릴레이 상태 조회"""
        if 0 <= relay_num < len(self.system_data['relays']):
            return self.system_data['relays'][relay_num]
        return None
    
    def get_master_data(self) -> Dict[str, Any]:
        """마스터 데이터 조회"""
        return self.system_data['master'].copy()
    
    def get_slaves_data(self) -> List[Dict[str, Any]]:
        """슬레이브 데이터 조회"""
        return self.system_data['slaves'].copy()
    
    def is_water_running(self) -> bool:
        """급수 시스템 실행 여부"""
        return self.system_data['water_running']
    
    @staticmethod
    def list_available_ports() -> List[Dict[str, str]]:
        """사용 가능한 포트 목록"""
        ports = []
        for port in serial.tools.list_ports.comports():
            ports.append({
                'device': port.device,
                'description': port.description,
                'hwid': port.hwid
            })
        return ports