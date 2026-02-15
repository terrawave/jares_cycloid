// ========== 웹 새로고침 시 릴레이 상태 유지 문제 해결 ==========
// 수정 사항:
// 1. WebSocket 연결 완료 후 서버 상태 로드
// 2. 서버 상태와 로컬 저장 상태 비교하여 필요한 경우에만 복원
// 3. 불필요한 릴레이 토글 방지

// WebSocket 연결
let ws = null;
let reconnectInterval = null;
let systemData = {
    relays: Array(16).fill(false),
    slaves: [],
    master: {},
    water_running: false
};

// 차트 초기화
let temperatureChart = null;
let humidityChart = null;
let co2Chart = null;
let luxChart = null;
let powerChart = null;
let energyChart = null;
let energyHourlyChart = null;
let energyDailyChart = null;
let energyMonthlyChart = null;
const maxDataPoints = 50; // 데이터베이스 기반이므로 더 많은 포인트 표시

// 차트 데이터 저장소
let chartDataStore = {
    temperature: {},
    humidity: {},
    co2: {},
    lux: {},
    power: [],
    energy: [],
    labels: []
};

// 모터 제어 상태
let currentMotorSpeed = 0;
let currentMotorDirection = 'stop';

// localStorage 키
const STORAGE_KEY = 'esp32_relay_state';

// 데이터 저장 배열 (메모리에만 유지)
let sensorDataLog = [];
let relayLog = [];
let systemLog = [];

// 초기화 상태 플래그
let serverStateLoaded = false;

// ========== 스케줄 관리 ==========
const MOTOR_SCHEDULE_KEY = 'esp32_motor_schedules';
const LED_SCHEDULE_KEY = 'esp32_led_schedules';
const MOTOR_MODE_KEY = 'esp32_motor_auto_mode';
const LED_MODE_KEY = 'esp32_led_auto_mode';

let motorSchedules = [];
let ledSchedules = [];
let motorAutoMode = true;
let ledAutoMode = true;
let scheduleCheckInterval = null;

// ✅ 수정된 초기화
document.addEventListener('DOMContentLoaded', () => {
    initRelayGrid();
    initCharts();
    initEnergyCharts();
    
    // 데이터베이스에서 데이터 로드
    loadStoredData();
    
    // 차트 히스토리 데이터 로드
    loadChartHistory();
    
    // 전력 사용량 데이터 로드
    loadEnergyCharts();
    loadEnergyUsageData();
    
    // WebSocket 초기화
    initWebSocket();
    
    // 스케줄 로드
    loadSchedules();
    
    // 1분마다 차트 데이터 새로고침 (서버가 1분마다 데이터베이스에 저장하므로)
    setInterval(() => {
        loadChartHistory();
    }, 60000); // 60초
    
    // 5분마다 전력 차트 업데이트
    setInterval(() => {
        loadEnergyCharts();
    }, 300000);
    
    // 10분마다 전력 사용량 데이터 업데이트
    setInterval(() => {
        loadEnergyUsageData();
    }, 600000);
});

// 탭 전환 함수
function switchTab(tabName) {
    // 모든 탭 버튼과 컨텐츠 비활성화
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // 선택된 탭 활성화
    event.target.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');
    
    // 그래프 탭이면 차트 리사이즈
    if (tabName === 'charts') {
        setTimeout(() => {
            if (temperatureChart) temperatureChart.resize();
            if (humidityChart) humidityChart.resize();
            if (co2Chart) co2Chart.resize();
            if (luxChart) luxChart.resize();
            if (powerChart) powerChart.resize();
            if (energyChart) energyChart.resize();
            if (energyHourlyChart) energyHourlyChart.resize();
            if (energyDailyChart) energyDailyChart.resize();
            if (energyMonthlyChart) energyMonthlyChart.resize();
        }, 100);
    }
    
    // 전력 사용량 탭이면 데이터 로드
    if (tabName === 'energy-usage') {
        loadEnergyUsageData();
    }
}

// ========== 데이터베이스에서 차트 히스토리 로드 ==========
async function loadChartHistory() {
    try {
        // 최근 50개 센서 데이터 가져오기
        const sensorResponse = await fetch('/api/db/sensor_data?limit=50');
        if (!sensorResponse.ok) throw new Error('Failed to load sensor history');
        
        const sensorResult = await sensorResponse.json();
        const sensorData = sensorResult.data || [];
        
        // 최근 50개 전력 데이터 가져오기
        const powerResponse = await fetch('/api/db/power_realtime?limit=50');
        if (!powerResponse.ok) throw new Error('Failed to load power history');
        
        const powerResult = await powerResponse.json();
        const powerData = powerResult.data || [];
        
        // 센서 데이터 처리 (시간 역순으로 정렬)
        sensorData.reverse();
        
        // 디바이스별로 데이터 그룹화
        const deviceData = {};
        sensorData.forEach(record => {
            if (!deviceData[record.device]) {
                deviceData[record.device] = {
                    temperature: [],
                    humidity: [],
                    co2: [],
                    lux: [],
                    labels: []
                };
            }
            
            const time = new Date(record.timestamp).toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit'
            });
            
            deviceData[record.device].labels.push(time);
            deviceData[record.device].temperature.push(record.temperature);
            deviceData[record.device].humidity.push(record.humidity);
            deviceData[record.device].co2.push(record.co2);
            deviceData[record.device].lux.push(record.lux);
        });
        
        // 차트 데이터 저장소 업데이트
        chartDataStore.temperature = {};
        chartDataStore.humidity = {};
        chartDataStore.co2 = {};
        chartDataStore.lux = {};
        chartDataStore.labels = [];
        
        Object.keys(deviceData).forEach(device => {
            chartDataStore.temperature[device] = deviceData[device].temperature;
            chartDataStore.humidity[device] = deviceData[device].humidity;
            chartDataStore.co2[device] = deviceData[device].co2;
            chartDataStore.lux[device] = deviceData[device].lux;
            
            // 레이블은 첫 번째 디바이스의 것을 사용
            if (chartDataStore.labels.length === 0) {
                chartDataStore.labels = deviceData[device].labels;
            }
        });
        
        // 전력 데이터 처리 (시간 역순으로 정렬)
        powerData.reverse();
        chartDataStore.power = [];
        chartDataStore.energy = [];
        const powerLabels = [];
        
        powerData.forEach(record => {
            const time = new Date(record.timestamp).toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit'
            });
            powerLabels.push(time);
            chartDataStore.power.push(record.power);
        });
        
        // 차트 업데이트
        updateChartsFromStore();
        
        addLog('차트 히스토리 데이터 로드 완료', 'success');
    } catch (error) {
        console.error('Failed to load chart history:', error);
        addLog('차트 히스토리 로드 실패: ' + error.message, 'error');
    }
}

// ========== 데이터베이스에서 데이터 로드 ==========
async function loadStoredData() {
    try {
        // 센서 데이터 로드
        const sensorResponse = await fetch('/api/db/sensor_data?limit=100');
        if (sensorResponse.ok) {
            const sensorResult = await sensorResponse.json();
            sensorDataLog = sensorResult.data || [];
            updateSensorDataTable();
        }
        
        // 릴레이 로그 로드
        const relayResponse = await fetch('/api/db/relay_logs?limit=100');
        if (relayResponse.ok) {
            const relayResult = await relayResponse.json();
            relayLog = relayResult.logs || [];
            updateRelayLogTable();
        }
        
        // 시스템 로그 로드
        const systemResponse = await fetch('/api/db/system_logs?limit=100');
        if (systemResponse.ok) {
            const systemResult = await systemResponse.json();
            systemLog = systemResult.logs || [];
            updateSystemLogDisplay();
        }
    } catch (error) {
        console.error('Failed to load data from database:', error);
        addLog('데이터베이스에서 데이터 로드 실패', 'error');
    }
}

// 센서 데이터 테이블 업데이트
function updateSensorDataTable() {
    const tbody = document.getElementById('sensor-data-body');
    const count = document.getElementById('sensor-data-count');
    
    if (!tbody) return;
    
    count.textContent = sensorDataLog.length;
    
    // 최근 100개만 표시
    const recentData = sensorDataLog.slice(0, 100);
    
    tbody.innerHTML = recentData.map(data => `
        <tr>
            <td>${new Date(data.timestamp).toLocaleString('ko-KR')}</td>
            <td>${data.device}</td>
            <td>${data.temperature?.toFixed(1) || '-'}</td>
            <td>${data.humidity?.toFixed(1) || '-'}</td>
            <td>${data.co2 || '-'}</td>
            <td>${data.lux?.toFixed(0) || '-'}</td>
        </tr>
    `).join('');
}

// 릴레이 로그 추가 (localStorage 저장 제거)
function addRelayLog(relayNum, action, state) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        relay: relayNum,
        action: action,
        state: state ? 'ON' : 'OFF'
    };
    
    relayLog.unshift(logEntry);
    
    if (relayLog.length > 5000) {
        relayLog = relayLog.slice(0, 5000);
    }
    
    // localStorage 저장 제거 - 서버에서 자동 저장됨
    updateRelayLogTable();
}

// 릴레이 로그 테이블 업데이트
function updateRelayLogTable() {
    const tbody = document.getElementById('relay-log-body');
    const count = document.getElementById('relay-log-count');
    
    if (!tbody) return;
    
    count.textContent = relayLog.length;
    
    const recentLogs = relayLog.slice(0, 100);
    
    tbody.innerHTML = recentLogs.map(log => `
        <tr>
            <td>${new Date(log.timestamp).toLocaleString('ko-KR')}</td>
            <td>R${log.relay}</td>
            <td>${log.action}</td>
            <td><span class="status-badge ${log.state === 'ON' ? 'running' : ''}">${log.state}</span></td>
        </tr>
    `).join('');
}

// 시스템 로그 표시 업데이트
function updateSystemLogDisplay() {
    const container = document.getElementById('log-container');
    const count = document.getElementById('system-log-count');
    
    if (!container) return;
    
    count.textContent = systemLog.length;
    
    container.innerHTML = systemLog.slice(0, 100).map(log => 
        `<div class="log-entry ${log.type}">${log.message}</div>`
    ).join('');
    
    container.scrollTop = container.scrollHeight;
}

// ========== CSV 다운로드 함수 (데이터베이스 API 사용) ==========
async function downloadSensorData() {
    try {
        const response = await fetch('/api/db/export/sensor_data');
        if (!response.ok) throw new Error('다운로드 실패');
        
        const result = await response.json();
        downloadFile(result.csv, 'sensor_data.csv', 'text/csv');
    } catch (error) {
        alert('센서 데이터 다운로드에 실패했습니다.');
        console.error(error);
    }
}

function downloadSystemLogs() {
    // 시스템 로그는 메모리에서 다운로드
    if (systemLog.length === 0) {
        alert('다운로드할 로그가 없습니다.');
        return;
    }
    
    let txt = systemLog.map(log => log.message).join('\n');
    downloadFile(txt, 'system_logs.txt', 'text/plain');
}

async function downloadRelayLogs() {
    try {
        const response = await fetch('/api/db/export/relay_logs');
        if (!response.ok) throw new Error('다운로드 실패');
        
        const result = await response.json();
        downloadFile(result.csv, 'relay_logs.csv', 'text/csv');
    } catch (error) {
        alert('릴레이 로그 다운로드에 실패했습니다.');
        console.error(error);
    }
}

function downloadFile(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ========== 데이터 삭제 함수 (데이터베이스 API 사용) ==========
async function clearSensorData() {
    if (confirm('모든 센서 데이터를 삭제하시겠습니까?')) {
        try {
            const response = await fetch('/api/db/sensor_data', { method: 'DELETE' });
            if (!response.ok) throw new Error('삭제 실패');
            
            sensorDataLog = [];
            updateSensorDataTable();
            // 차트도 초기화
            chartDataStore = {
                temperature: {},
                humidity: {},
                co2: {},
                lux: {},
                power: [],
                energy: [],
                labels: []
            };
            updateChartsFromStore();
            addLog('센서 데이터가 삭제되었습니다', 'info');
        } catch (error) {
            alert('센서 데이터 삭제에 실패했습니다.');
            console.error(error);
        }
    }
}

async function clearSystemLogs() {
    if (confirm('모든 시스템 로그를 삭제하시겠습니까?')) {
        try {
            const response = await fetch('/api/db/system_logs', { method: 'DELETE' });
            if (!response.ok) throw new Error('삭제 실패');
            
            systemLog = [];
            updateSystemLogDisplay();
            addLog('시스템 로그가 삭제되었습니다', 'info');
        } catch (error) {
            alert('시스템 로그 삭제에 실패했습니다.');
            console.error(error);
        }
    }
}

async function clearRelayLogs() {
    if (confirm('모든 릴레이 제어 로그를 삭제하시겠습니까?')) {
        try {
            const response = await fetch('/api/db/relay_logs', { method: 'DELETE' });
            if (!response.ok) throw new Error('삭제 실패');
            
            relayLog = [];
            updateRelayLogTable();
            addLog('릴레이 로그가 삭제되었습니다', 'info');
        } catch (error) {
            alert('릴레이 로그 삭제에 실패했습니다.');
            console.error(error);
        }
    }
}

// ✅ 수정된 WebSocket 초기화
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        updateConnectionStatus(true);
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
        
        // ✅ WebSocket 연결 후 서버 상태 로드
        loadInitialStatus();
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateConnectionStatus(false);
        if (!reconnectInterval) {
            reconnectInterval = setInterval(() => {
                initWebSocket();
            }, 5000);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// WebSocket 메시지 처리
function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'initial_status':
        case 'status_update':
            updateSystemStatus(message.data);
            break;
        case 'command_response':
            addLog(`응답: ${message.response}`, 'success');
            break;
        case 'error':
            addLog(`에러: ${message.error}`, 'error');
            break;
    }
}

// 연결 상태 업데이트
function updateConnectionStatus(connected) {
    const indicator = document.getElementById('connection-indicator');
    const text = document.getElementById('connection-text');
    
    if (connected) {
        indicator.classList.add('connected');
        text.textContent = '연결됨';
    } else {
        indicator.classList.remove('connected');
        text.textContent = '연결 끊김';
    }
}

// ✅ 수정된 시스템 상태 업데이트 함수
function updateSystemStatus(data) {
    systemData = data;
    
    if (data.relays) {
        updateRelayDisplay(data.relays);
        updateMotorControls(data.relays);
        
        // ✅ 서버 상태가 로드되면 저장
        if (serverStateLoaded) {
            saveState();
        }
    }
    
    // master (WebSocket) 또는 master_power (API) 둘 다 처리
    const masterData = data.master || data.master_power;
    if (masterData) {
        updatePowerMonitor(masterData);
    }
    
    if (data.slaves) {
        updateSlaves(data.slaves);
    }
    
    if (data.water_running !== undefined) {
        updateWaterStatus(data.water_running);
    } else if (data.water_status) {
        updateWaterStatus(data.water_status.running);
        // 설정값 반영
        if (data.water_status.config) {
            updateWaterConfig(data.water_status.config);
        }
    }

    if (data.drain_running !== undefined) {
        updateDrainStatus(data.drain_running);
    } else if (data.drain_status) {
        updateDrainStatus(data.drain_status.running, data.drain_status.progress);
        // 설정값 반영
        if (data.drain_status.config) {
            updateDrainConfig(data.drain_status.config);
        }
    }
}

// 급수 설정값 UI 업데이트
function updateWaterConfig(config) {
    if (config.delay !== undefined) {
        const delayInput = document.getElementById('water-delay');
        if (delayInput) delayInput.value = config.delay;
    }
    if (config.duration !== undefined) {
        const durationInput = document.getElementById('water-duration');
        if (durationInput) durationInput.value = config.duration;
    }
    if (config.cycles !== undefined) {
        const cyclesInput = document.getElementById('water-cycles');
        if (cyclesInput) cyclesInput.value = config.cycles;
    }
}

// 배수 설정값 UI 업데이트
function updateDrainConfig(config) {
    if (config.delay !== undefined) {
        const delayInput = document.getElementById('drain-delay');
        if (delayInput) delayInput.value = config.delay;
    }
    if (config.duration !== undefined) {
        const durationInput = document.getElementById('drain-duration');
        if (durationInput) durationInput.value = config.duration;
    }
    if (config.cycles !== undefined) {
        const cyclesInput = document.getElementById('drain-cycles');
        if (cyclesInput) cyclesInput.value = config.cycles;
    }
}

// 상태 저장
function saveState() {
    try {
        const stateToSave = {
            relays: systemData.relays,
            motorSpeed: currentMotorSpeed,
            motorDirection: currentMotorDirection,
            timestamp: new Date().toISOString()
        };
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
        console.error('Failed to save state:', error);
    }
}

// ✅ 수정된 저장된 상태 복원
async function restoreSavedState() {
    try {
        const savedState = localStorage.getItem(STORAGE_KEY);
        if (!savedState) {
            document.querySelector('[data-direction="stop"]')?.classList.add('active');
            addLog('저장된 상태 없음', 'info');
            return;
        }
        
        const state = JSON.parse(savedState);
        const timeDiff = Date.now() - new Date(state.timestamp).getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        
        // 24시간 이내의 상태만 복원
        if (hoursDiff < 24) {
            // ✅ 서버 상태와 로컬 저장 상태를 비교
            let needsRestore = false;
            
            // 릴레이 상태 비교
            for (let i = 0; i < 16; i++) {
                if (systemData.relays[i] !== state.relays[i]) {
                    needsRestore = true;
                    break;
                }
            }
            
            if (needsRestore) {
                addLog(`이전 상태 복원 중... (${Math.floor(hoursDiff)}시간 전)`, 'info');
                
                // 모터 속도 복원
                if (state.motorSpeed > 0) {
                    await setMotorSpeed(state.motorSpeed);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // 모터 방향 복원
                if (state.motorDirection && state.motorDirection !== 'stop') {
                    await setMotorDirection(state.motorDirection);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // LED 및 양액 릴레이 복원
                await restoreRelays(state.relays);
                
                addLog('상태 복원 완료', 'success');
            } else {
                addLog('서버 상태와 동일함', 'info');
            }
        } else {
            addLog('저장된 상태가 오래되어 복원하지 않음', 'info');
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch (error) {
        console.error('Failed to restore state:', error);
        addLog('상태 복원 실패', 'error');
    }
}

async function restoreRelays(relayStates) {
    // LED 릴레이 복원 (10, 11, 12)
    for (let i = 10; i <= 12; i++) {
        if (systemData.relays[i] !== relayStates[i]) {
            try {
                await fetch(`/api/relay/${i}?state=${relayStates[i]}`, { method: 'POST' });
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Failed to restore LED ${i}:`, error);
            }
        }
    }
    
    // 양액 릴레이 복원 (3, 4, 5, 6)
    for (let i = 3; i <= 6; i++) {
        if (systemData.relays[i] !== relayStates[i]) {
            try {
                await fetch(`/api/relay/${i}?state=${relayStates[i]}`, { method: 'POST' });
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Failed to restore nutrient relay ${i}:`, error);
            }
        }
    }
}

function initRelayGrid() {}

function updateRelayDisplay(relays) {
    [10, 11, 12].forEach(relayNum => {
        const btn = document.querySelector(`.btn-led[data-relay="${relayNum}"]`);
        if (btn) {
            if (relays[relayNum]) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
    
    [3, 4, 5, 6].forEach(relayNum => {
        const btn = document.querySelector(`.btn-nutrient[data-relay="${relayNum}"]`);
        if (btn) {
            if (relays[relayNum]) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
}

function updateMotorControls(relays) {
    document.querySelectorAll('.btn-speed').forEach(btn => btn.classList.remove('active'));
    
    if (relays[0]) {
        document.querySelector('.btn-speed[data-speed="1"]')?.classList.add('active');
        currentMotorSpeed = 1;
    } else if (relays[1]) {
        document.querySelector('.btn-speed[data-speed="2"]')?.classList.add('active');
        currentMotorSpeed = 2;
    } else if (relays[2]) {
        document.querySelector('.btn-speed[data-speed="3"]')?.classList.add('active');
        currentMotorSpeed = 3;
    } else {
        currentMotorSpeed = 0;
    }
    
    document.querySelectorAll('.btn-direction').forEach(btn => btn.classList.remove('active'));
    
    if (relays[8] && !relays[9]) {
        document.querySelector('.btn-direction[data-direction="forward"]')?.classList.add('active');
        currentMotorDirection = 'forward';
    } else if (!relays[8] && relays[9]) {
        document.querySelector('.btn-direction[data-direction="reverse"]')?.classList.add('active');
        currentMotorDirection = 'reverse';
    } else {
        document.querySelector('.btn-direction[data-direction="stop"]')?.classList.add('active');
        currentMotorDirection = 'stop';
    }
}

// ==================== 🔧 수동 제어 시 자동 모드 전환 ====================

async function toggleLED(relayNum) {
    // 🆕 자동 모드였다면 수동 모드로 전환
    if (ledAutoMode) {
        ledAutoMode = false;
        localStorage.setItem(LED_MODE_KEY, JSON.stringify(ledAutoMode));
        updateLEDModeDisplay();
        addLog('수동 제어 감지 - LED 수동 모드로 전환', 'info');
    }
    
    const btn = document.querySelector(`.btn-led[data-relay="${relayNum}"]`);
    if (!btn) return;
    
    const currentState = systemData.relays[relayNum];
    const newState = !currentState;
    
    if (newState) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
    
    systemData.relays[relayNum] = newState;
    addLog(`LED ${relayNum - 9}: ${newState ? 'ON' : 'OFF'}`, 'success');
    addRelayLog(relayNum, `LED ${relayNum - 9}`, newState);
    
    try {
        const response = await fetch(`/api/relay/${relayNum}?state=${newState}`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to control LED');
    } catch (error) {
        if (currentState) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        systemData.relays[relayNum] = currentState;
        addLog(`LED 제어 실패: ${error.message}`, 'error');
    }
}

async function toggleNutrient(relayNum) {
    const btn = document.querySelector(`.btn-nutrient[data-relay="${relayNum}"]`);
    if (!btn) return;
    
    const currentState = systemData.relays[relayNum];
    const newState = !currentState;
    
    const names = {
        3: '배수',
        4: '급수밸브',
        5: '양액',
        6: '물밸브'
    };
    
    if (newState) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
    
    systemData.relays[relayNum] = newState;
    addLog(`${names[relayNum]}: ${newState ? 'ON' : 'OFF'}`, 'success');
    addRelayLog(relayNum, names[relayNum], newState);
    
    try {
        const response = await fetch(`/api/relay/${relayNum}?state=${newState}`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to control nutrient system');
    } catch (error) {
        if (currentState) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        systemData.relays[relayNum] = currentState;
        addLog(`양액 시스템 제어 실패: ${error.message}`, 'error');
    }
}

async function setMotorSpeed(speed) {
    // 🆕 자동 모드였다면 수동 모드로 전환
    if (motorAutoMode) {
        motorAutoMode = false;
        localStorage.setItem(MOTOR_MODE_KEY, JSON.stringify(motorAutoMode));
        updateMotorModeDisplay();
        addLog('수동 제어 감지 - 모터 수동 모드로 전환', 'info');
    }
    
    document.querySelectorAll('.btn-speed').forEach(btn => btn.classList.remove('active'));
    
    if (speed > 0) {
        const btn = document.querySelector(`.btn-speed[data-speed="${speed}"]`);
        if (btn) btn.classList.add('active');
    }
    
    currentMotorSpeed = speed;
    systemData.relays[0] = speed === 1;
    systemData.relays[1] = speed === 2;
    systemData.relays[2] = speed === 3;
    
    try {
        await Promise.all([
            fetch('/api/relay/0?state=false', { method: 'POST' }),
            fetch('/api/relay/1?state=false', { method: 'POST' }),
            fetch('/api/relay/2?state=false', { method: 'POST' })
        ]);
        
        if (speed > 0) {
            const relayNum = speed - 1;
            await fetch(`/api/relay/${relayNum}?state=true`, { method: 'POST' });
            addLog(`모터 속도 ${speed} 설정`, 'success');
            addRelayLog(relayNum, `모터 속도 ${speed}`, true);
        }
    } catch (error) {
        addLog(`모터 속도 설정 실패: ${error.message}`, 'error');
    }
}

async function setMotorDirection(direction) {
    // 🆕 자동 모드였다면 수동 모드로 전환
    if (motorAutoMode) {
        motorAutoMode = false;
        localStorage.setItem(MOTOR_MODE_KEY, JSON.stringify(motorAutoMode));
        updateMotorModeDisplay();
        addLog('수동 제어 감지 - 모터 수동 모드로 전환', 'info');
    }
    
    document.querySelectorAll('.btn-direction').forEach(btn => btn.classList.remove('active'));
    
    const btn = document.querySelector(`.btn-direction[data-direction="${direction}"]`);
    if (btn) btn.classList.add('active');
    
    currentMotorDirection = direction;
    
    const directionNames = {
        'forward': '정회전',
        'reverse': '역회전',
        'stop': '정지'
    };
    
    if (direction === 'forward') {
        systemData.relays[8] = true;
        systemData.relays[9] = false;
        addLog('모터 정회전 시작', 'success');
        addRelayLog(8, directionNames[direction], true);
    } else if (direction === 'reverse') {
        systemData.relays[8] = false;
        systemData.relays[9] = true;
        addLog('모터 역회전 시작', 'success');
        addRelayLog(9, directionNames[direction], true);
    } else {
        systemData.relays[8] = false;
        systemData.relays[9] = false;
        addLog('모터 정지', 'info');
        addRelayLog(8, directionNames[direction], false);
    }
    
    try {
        const promises = [];
        
        if (direction === 'forward') {
            promises.push(
                fetch('/api/relay/8?state=true', { method: 'POST' }),
                fetch('/api/relay/9?state=false', { method: 'POST' })
            );
        } else if (direction === 'reverse') {
            promises.push(
                fetch('/api/relay/8?state=false', { method: 'POST' }),
                fetch('/api/relay/9?state=true', { method: 'POST' })
            );
        } else {
            promises.push(
                fetch('/api/relay/8?state=false', { method: 'POST' }),
                fetch('/api/relay/9?state=false', { method: 'POST' })
            );
        }
        
        await Promise.all(promises);
    } catch (error) {
        addLog(`모터 방향 설정 실패: ${error.message}`, 'error');
    }
}

function updatePowerMonitor(data) {
    document.getElementById('voltage').textContent = data.voltage?.toFixed(1) || '0';
    document.getElementById('current').textContent = data.current?.toFixed(3) || '0';
    document.getElementById('power').textContent = data.power?.toFixed(1) || '0';
    document.getElementById('frequency').textContent = data.frequency?.toFixed(1) || '0';
    
    // ✅ 모터 속도값 업데이트
    const motorSpeedAdc = document.getElementById('motor-speed-adc');
    if (motorSpeedAdc) {
        motorSpeedAdc.textContent = data.motor_adc || '0';
    }
    
    // ✅ 근접센서 상태 업데이트
    const proximitySensor = document.getElementById('proximity-sensor');
    if (proximitySensor) {
        if (data.proximity) {
            proximitySensor.textContent = '감지됨';
            proximitySensor.style.color = 'var(--color-success)';
        } else {
            proximitySensor.textContent = '미감지';
            proximitySensor.style.color = 'var(--color-danger)';
        }
    }
}

function updateSlaves(slaves) {
    const container = document.getElementById('slaves-container');
    container.innerHTML = '';
    
    if (slaves.length === 0) {
        container.innerHTML = '<p>연결된 센서가 없습니다.</p>';
        return;
    }
    
    // ✅ 센서 이름 기준으로 정렬 (실내센서1, 실내센서2, 실내센서3 순서)
    slaves.sort((a, b) => a.name.localeCompare(b.name));
    
    slaves.forEach(slave => {
        const card = document.createElement('div');
        card.className = 'slave-card';
        
        card.innerHTML = `
            <div class="slave-header">
                <span class="slave-name">${slave.name}</span>
                <span class="slave-status online"></span>
            </div>
            <div class="sensor-grid">
                <div class="sensor-item">
                    <div class="sensor-label">온도</div>
                    <span class="sensor-value">${slave.temperature?.toFixed(1) || '0'}</span>
                    <span class="sensor-unit">°C</span>
                </div>
                <div class="sensor-item">
                    <div class="sensor-label">습도</div>
                    <span class="sensor-value">${slave.humidity?.toFixed(1) || '0'}</span>
                    <span class="sensor-unit">%</span>
                </div>
                <div class="sensor-item">
                    <div class="sensor-label">CO2</div>
                    <span class="sensor-value">${slave.co2 || '0'}</span>
                    <span class="sensor-unit">ppm</span>
                </div>
                <div class="sensor-item">
                    <div class="sensor-label">조도</div>
                    <span class="sensor-value">${slave.lux?.toFixed(0) || '0'}</span>
                    <span class="sensor-unit">lux</span>
                </div>
            </div>
        `;
        
        container.appendChild(card);
    });
}


// 차트 초기화
function initCharts() {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
    
    // 온도 차트
    const tempCtx = document.getElementById('temperatureChart')?.getContext('2d');
    if (tempCtx) {
        temperatureChart = new Chart(tempCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '온도 (°C)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: { color: '#ecf0f1' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    x: {
                        ticks: { 
                            color: '#ecf0f1',
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
    
    // 습도 차트
    const humCtx = document.getElementById('humidityChart')?.getContext('2d');
    if (humCtx) {
        humidityChart = new Chart(humCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '습도 (%)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { color: '#ecf0f1' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    x: {
                        ticks: { 
                            color: '#ecf0f1',
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
    
    // CO2 차트
    const co2Ctx = document.getElementById('co2Chart')?.getContext('2d');
    if (co2Ctx) {
        co2Chart = new Chart(co2Ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'CO2 (ppm)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#ecf0f1' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    x: {
                        ticks: { 
                            color: '#ecf0f1',
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
    
    // 조도 차트
    const luxCtx = document.getElementById('luxChart')?.getContext('2d');
    if (luxCtx) {
        luxChart = new Chart(luxCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '조도 (lux)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#ecf0f1' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    x: {
                        ticks: { 
                            color: '#ecf0f1',
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
    
    // 전력 차트
    const powerCtx = document.getElementById('powerChart')?.getContext('2d');
    if (powerCtx) {
        powerChart = new Chart(powerCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: '전력 (W)',
                    data: [],
                    borderColor: '#e67e22',
                    backgroundColor: 'rgba(230, 126, 34, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '소비 전력 (W)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#ecf0f1' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    x: {
                        ticks: { 
                            color: '#ecf0f1',
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
}

// 데이터 저장소에서 차트 업데이트
function updateChartsFromStore() {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
    
    // 센서 데이터 차트 업데이트
    const devices = Object.keys(chartDataStore.temperature);
    
    // 온도 차트
    if (temperatureChart) {
        temperatureChart.data.labels = chartDataStore.labels;
        temperatureChart.data.datasets = devices.map((device, index) => ({
            label: device,
            data: chartDataStore.temperature[device],
            borderColor: colors[index % colors.length],
            backgroundColor: `${colors[index % colors.length]}20`,
            tension: 0.4,
            fill: true
        }));
        temperatureChart.update('none');
    }
    
    // 습도 차트
    if (humidityChart) {
        humidityChart.data.labels = chartDataStore.labels;
        humidityChart.data.datasets = devices.map((device, index) => ({
            label: device,
            data: chartDataStore.humidity[device],
            borderColor: colors[index % colors.length],
            backgroundColor: `${colors[index % colors.length]}20`,
            tension: 0.4,
            fill: true
        }));
        humidityChart.update('none');
    }
    
    // CO2 차트
    if (co2Chart) {
        co2Chart.data.labels = chartDataStore.labels;
        co2Chart.data.datasets = devices.map((device, index) => ({
            label: device,
            data: chartDataStore.co2[device],
            borderColor: colors[index % colors.length],
            backgroundColor: `${colors[index % colors.length]}20`,
            tension: 0.4,
            fill: true
        }));
        co2Chart.update('none');
    }
    
    // 조도 차트
    if (luxChart) {
        luxChart.data.labels = chartDataStore.labels;
        luxChart.data.datasets = devices.map((device, index) => ({
            label: device,
            data: chartDataStore.lux[device],
            borderColor: colors[index % colors.length],
            backgroundColor: `${colors[index % colors.length]}20`,
            tension: 0.4,
            fill: true
        }));
        luxChart.update('none');
    }
    
    // 전력 차트
    if (powerChart && chartDataStore.power.length > 0) {
        const powerLabels = chartDataStore.power.map((_, index) => {
            const totalData = chartDataStore.power.length;
            if (totalData > 0 && chartDataStore.labels.length > 0) {
                const ratio = chartDataStore.labels.length / totalData;
                const labelIndex = Math.floor(index * ratio);
                return chartDataStore.labels[Math.min(labelIndex, chartDataStore.labels.length - 1)];
            }
            return '';
        });
        
        powerChart.data.labels = powerLabels;
        powerChart.data.datasets[0].data = chartDataStore.power;
        powerChart.update('none');
    }
}

// 자동 급수
async function configWater() {
    const delay = document.getElementById('water-delay').value;
    const duration = document.getElementById('water-duration').value;
    const cycles = document.getElementById('water-cycles').value;
    
    try {
        const response = await fetch('/api/water', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'config',
                config: {
                    delay_a: parseInt(delay),
                    duration_b: parseInt(duration),
                    cycle_count: parseInt(cycles)
                }
            })
        });
        
        if (!response.ok) throw new Error('Failed to configure water system');
        
        addLog(`급수 설정: 대기 ${delay}초, 급수 ${duration}초, ${cycles}회 반복`, 'success');
    } catch (error) {
        addLog(`급수 설정 실패: ${error.message}`, 'error');
    }
}

async function startWater() {
    try {
        const response = await fetch('/api/water', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: 'start' })
        });
        
        if (!response.ok) throw new Error('Failed to start water system');
        
        addLog('자동 급수 시작', 'success');
    } catch (error) {
        addLog(`급수 시작 실패: ${error.message}`, 'error');
    }
}

async function stopWater() {
    try {
        const response = await fetch('/api/water', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: 'stop' })
        });
        
        if (!response.ok) throw new Error('Failed to stop water system');
        
        addLog('자동 급수 정지', 'success');
    } catch (error) {
        addLog(`급수 정지 실패: ${error.message}`, 'error');
    }
}

function updateWaterStatus(running) {
    const statusElement = document.getElementById('water-status');
    if (running) {
        statusElement.textContent = '작동 중';
        statusElement.classList.add('running');
    } else {
        statusElement.textContent = '정지';
        statusElement.classList.remove('running');
    }
}

// ==================== 자동 배수 시스템 ====================

async function configDrain() {
    const delay = document.getElementById('drain-delay').value;
    const duration = document.getElementById('drain-duration').value;
    const cycles = document.getElementById('drain-cycles').value;

    try {
        const response = await fetch('/api/drain', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'config',
                config: {
                    delay_a: parseInt(delay),
                    duration_b: parseInt(duration),
                    cycle_count: parseInt(cycles)
                }
            })
        });

        if (!response.ok) throw new Error('Failed to configure drain system');

        addLog(`배수 설정: 대기 ${delay}초, 배수 ${duration}초, ${cycles}회 반복`, 'success');
    } catch (error) {
        addLog(`배수 설정 실패: ${error.message}`, 'error');
    }
}

async function startDrain() {
    try {
        const response = await fetch('/api/drain', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: 'start' })
        });

        if (!response.ok) throw new Error('Failed to start drain system');

        addLog('자동 배수 시작', 'success');

        // 즉시 상태 업데이트
        const statusResponse = await fetch('/api/status');
        if (statusResponse.ok) {
            const data = await statusResponse.json();
            updateSystemStatus(data);
        }
    } catch (error) {
        addLog(`배수 시작 실패: ${error.message}`, 'error');
    }
}

async function stopDrain() {
    try {
        const response = await fetch('/api/drain', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: 'stop' })
        });

        if (!response.ok) throw new Error('Failed to stop drain system');

        addLog('자동 배수 정지', 'success');

        // 즉시 상태 업데이트
        const statusResponse = await fetch('/api/status');
        if (statusResponse.ok) {
            const data = await statusResponse.json();
            updateSystemStatus(data);
        }
    } catch (error) {
        addLog(`배수 정지 실패: ${error.message}`, 'error');
    }
}

function updateDrainStatus(running, progress) {
    const statusElement = document.getElementById('drain-status');
    const progressContainer = document.getElementById('drain-progress-container');

    if (statusElement) {
        if (running) {
            statusElement.textContent = '작동 중';
            statusElement.classList.add('running');
        } else {
            statusElement.textContent = '정지';
            statusElement.classList.remove('running');
        }
    }

    // 진행 상황 표시 업데이트
    if (progressContainer) {
        if (running && progress) {
            progressContainer.style.display = 'block';
            updateDrainProgress(progress);
        } else {
            progressContainer.style.display = 'none';
        }
    }
}

function updateDrainProgress(progress) {
    const progressText = document.getElementById('drain-progress-text');
    const phaseText = document.getElementById('drain-phase-text');
    const remainingText = document.getElementById('drain-remaining-text');
    const progressBar = document.getElementById('drain-progress-bar');

    if (!progress) return;

    // 사이클 진행 상황
    if (progressText) {
        progressText.textContent = `사이클 ${progress.current_cycle}/${progress.total_cycles}`;
    }

    // 현재 단계 표시
    if (phaseText) {
        const phaseNames = {
            'idle': '대기 중',
            'starting': '시작 중...',
            'waiting_undetected': '미감지 대기 중 (1초)...',
            'waiting_sensor': '센서 감지 대기 중...',
            'motor_running': '모터 작동 중',
            'delay': '감지 유지 확인 중',
            'draining': '배수 중'
        };
        phaseText.textContent = phaseNames[progress.phase] || progress.phase;
    }

    // 남은 시간
    if (remainingText) {
        remainingText.textContent = `${progress.phase_remaining}초`;
    }

    // 진행률 바
    if (progressBar && progress.total_cycles > 0) {
        const percentage = ((progress.current_cycle - 1) / progress.total_cycles) * 100;
        progressBar.style.width = `${Math.min(percentage, 100)}%`;
    }
}

// ✅ 수정된 초기 상태 로드
async function loadInitialStatus() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) throw new Error('Failed to get status');
        
        const data = await response.json();
        updateSystemStatus(data);
        
        // ✅ 서버 상태 로드 완료 플래그 설정
        serverStateLoaded = true;
        
        // ✅ 모든 릴레이가 꺼져있으면 서버가 재시작된 것으로 판단
        const allRelaysOff = data.relays && data.relays.every(state => !state);
        
        if (allRelaysOff) {
            addLog('서버 재시작 감지 - 이전 상태 복원 중...', 'info');
            // 잠시 대기 후 복원 (서버가 완전히 준비될 시간 확보)
            setTimeout(() => {
                restoreSavedState();
            }, 1000);
        } else {
            addLog('시스템 초기화 완료', 'info');
            // 서버에 이미 상태가 있으면 그것을 저장
            saveState();
        }
    } catch (error) {
        addLog(`초기화 실패: ${error.message}`, 'error');
        // 초기화 실패 시에도 복원 시도
        setTimeout(() => {
            restoreSavedState();
        }, 1000);
    }
}

function addLog(message, type = 'info') {
    const container = document.getElementById('log-container');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const time = new Date().toLocaleTimeString();
    const fullMessage = `[${time}] ${message}`;
    entry.textContent = fullMessage;
    
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
    
    while (container.children.length > 100) {
        container.removeChild(container.firstChild);
    }
    
    // 시스템 로그에 저장 (메모리에만)
    systemLog.unshift({
        timestamp: new Date().toISOString(),
        message: fullMessage,
        type: type
    });
    
    if (systemLog.length > 5000) {
        systemLog = systemLog.slice(0, 5000);
    }
    
    const count = document.getElementById('system-log-count');
    if (count) {
        count.textContent = systemLog.length;
    }
}

// ========== 스케줄 관리 ==========

// 스케줄 로드
function loadSchedules() {
    try {
        const savedMotorSchedules = localStorage.getItem(MOTOR_SCHEDULE_KEY);
        if (savedMotorSchedules) {
            motorSchedules = JSON.parse(savedMotorSchedules);
            updateMotorScheduleList();
            updateMotorSchedulePreview();
        }
        
        const savedLEDSchedules = localStorage.getItem(LED_SCHEDULE_KEY);
        if (savedLEDSchedules) {
            ledSchedules = JSON.parse(savedLEDSchedules);
            updateLEDScheduleList();
            updateLEDSchedulePreview();
        }
        
        // ✅ 저장된 모드 상태 복원
        const savedMotorMode = localStorage.getItem(MOTOR_MODE_KEY);
        if (savedMotorMode !== null) {
            motorAutoMode = JSON.parse(savedMotorMode);
        }
        
        const savedLEDMode = localStorage.getItem(LED_MODE_KEY);
        if (savedLEDMode !== null) {
            ledAutoMode = JSON.parse(savedLEDMode);
        }
        
        // 모드 표시 초기화
        updateMotorModeDisplay();
        updateLEDModeDisplay();
        
        // 1분마다 스케줄 체크
        if (scheduleCheckInterval) {
            clearInterval(scheduleCheckInterval);
        }
        scheduleCheckInterval = setInterval(checkSchedules, 60000);
        checkSchedules(); // 즉시 한번 체크
    } catch (error) {
        console.error('Failed to load schedules:', error);
    }
}

// 모터 스케줄 추가
function addMotorSchedule() {
    const startTime = document.getElementById('motor-start-time').value;
    const endTime = document.getElementById('motor-end-time').value;
    const speed = document.getElementById('motor-schedule-speed').value;
    const direction = document.getElementById('motor-schedule-direction').value;
    
    if (!startTime || !endTime) {
        alert('시작 시간과 종료 시간을 입력해주세요.');
        return;
    }
    
    const days = [];
    document.querySelectorAll('.schedule-section:first-child .day-checkbox input:checked').forEach(checkbox => {
        days.push(parseInt(checkbox.value));
    });
    
    if (days.length === 0) {
        alert('최소 하나의 요일을 선택해주세요.');
        return;
    }
    
    const schedule = {
        id: Date.now(),
        startTime,
        endTime,
        speed: parseInt(speed),
        direction,
        days,
        enabled: true
    };
    
    motorSchedules.push(schedule);
    localStorage.setItem(MOTOR_SCHEDULE_KEY, JSON.stringify(motorSchedules));
    
    updateMotorScheduleList();
    updateMotorSchedulePreview();
    
    addLog(`모터 스케줄 추가: ${startTime} - ${endTime}`, 'success');
}

// LED 스케줄 추가
function addLEDSchedule() {
    const onTime = document.getElementById('led-on-time').value;
    const offTime = document.getElementById('led-off-time').value;
    
    if (!onTime || !offTime) {
        alert('켜기 시간과 끄기 시간을 입력해주세요.');
        return;
    }
    
    const leds = [];
    document.querySelectorAll('.led-selector input:checked').forEach(checkbox => {
        leds.push(parseInt(checkbox.value));
    });
    
    if (leds.length === 0) {
        alert('최소 하나의 LED를 선택해주세요.');
        return;
    }
    
    const days = [];
    document.querySelectorAll('.schedule-section:last-child .day-checkbox input:checked').forEach(checkbox => {
        days.push(parseInt(checkbox.value));
    });
    
    if (days.length === 0) {
        alert('최소 하나의 요일을 선택해주세요.');
        return;
    }
    
    const schedule = {
        id: Date.now(),
        onTime,
        offTime,
        leds,
        days,
        enabled: true
    };
    
    ledSchedules.push(schedule);
    localStorage.setItem(LED_SCHEDULE_KEY, JSON.stringify(ledSchedules));
    
    updateLEDScheduleList();
    updateLEDSchedulePreview();
    
    addLog(`LED 스케줄 추가: ${onTime} ON - ${offTime} OFF`, 'success');
}

// 모터 스케줄 목록 업데이트
function updateMotorScheduleList() {
    const container = document.getElementById('motor-schedule-list');
    if (!container) return;
    
    if (motorSchedules.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">등록된 스케줄이 없습니다.</p>';
        return;
    }
    
    const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
    const directionNames = { 'forward': '정회전', 'reverse': '역회전' };
    
    container.innerHTML = motorSchedules.map(schedule => `
        <div class="schedule-item ${schedule.enabled ? 'active' : ''}">
            <div class="schedule-info">
                <div class="schedule-time">${schedule.startTime} - ${schedule.endTime}</div>
                <div class="schedule-details">속도 ${schedule.speed} / ${directionNames[schedule.direction]}</div>
                <div class="schedule-days">
                    ${schedule.days.map(day => `<span class="schedule-day">${dayNames[day]}</span>`).join('')}
                </div>
            </div>
            <div class="schedule-actions">
                <button class="schedule-toggle ${schedule.enabled ? 'enabled' : ''}" 
                        onclick="toggleMotorSchedule(${schedule.id})">
                    ${schedule.enabled ? '✓ 활성' : '✗ 비활성'}
                </button>
                <button class="schedule-delete" onclick="deleteMotorSchedule(${schedule.id})">
                    🗑️ 삭제
                </button>
            </div>
        </div>
    `).join('');
}

// LED 스케줄 목록 업데이트
function updateLEDScheduleList() {
    const container = document.getElementById('led-schedule-list');
    if (!container) return;
    
    if (ledSchedules.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">등록된 스케줄이 없습니다.</p>';
        return;
    }
    
    const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
    
    container.innerHTML = ledSchedules.map(schedule => `
        <div class="schedule-item ${schedule.enabled ? 'active' : ''}">
            <div class="schedule-info">
                <div class="schedule-time">${schedule.onTime} ON - ${schedule.offTime} OFF</div>
                <div class="schedule-details">LED ${schedule.leds.map(led => led - 9).join(', ')}</div>
                <div class="schedule-days">
                    ${schedule.days.map(day => `<span class="schedule-day">${dayNames[day]}</span>`).join('')}
                </div>
            </div>
            <div class="schedule-actions">
                <button class="schedule-toggle ${schedule.enabled ? 'enabled' : ''}" 
                        onclick="toggleLEDSchedule(${schedule.id})">
                    ${schedule.enabled ? '✓ 활성' : '✗ 비활성'}
                </button>
                <button class="schedule-delete" onclick="deleteLEDSchedule(${schedule.id})">
                    🗑️ 삭제
                </button>
            </div>
        </div>
    `).join('');
}

// 다음 스케줄 프리뷰 업데이트
function updateMotorSchedulePreview() {
    const preview = document.getElementById('motor-next-schedule');
    if (!preview) return;
    
    const nextSchedule = getNextMotorSchedule();
    
    if (!nextSchedule || !motorAutoMode) {
        preview.textContent = motorAutoMode ? '예정된 스케줄 없음' : '수동 모드 (스케줄 비활성)';
        return;
    }
    
    const directionNames = { 'forward': '정회전', 'reverse': '역회전' };
    preview.textContent = `${nextSchedule.day} ${nextSchedule.startTime} - 속도${nextSchedule.speed} ${directionNames[nextSchedule.direction]}`;
}

function updateLEDSchedulePreview() {
    const preview = document.getElementById('led-next-schedule');
    if (!preview) return;
    
    const nextSchedule = getNextLEDSchedule();
    
    if (!nextSchedule || !ledAutoMode) {
        preview.textContent = ledAutoMode ? '예정된 스케줄 없음' : '수동 모드 (스케줄 비활성)';
        return;
    }
    
    preview.textContent = `${nextSchedule.day} ${nextSchedule.time} ${nextSchedule.action} - LED ${nextSchedule.leds.map(l => l - 9).join(', ')}`;
}

function getNextMotorSchedule() {
    const now = new Date();
    const currentDay = (now.getDay() + 6) % 7;
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    const enabledSchedules = motorSchedules.filter(s => s.enabled);
    if (enabledSchedules.length === 0) return null;
    
    // 오늘 남은 스케줄
    const todaySchedules = enabledSchedules.filter(s => {
        if (!s.days.includes(currentDay)) return false;
        const [hour, min] = s.startTime.split(':').map(Number);
        const scheduleTime = hour * 60 + min;
        return scheduleTime > currentTime;
    });
    
    if (todaySchedules.length > 0) {
        const sorted = todaySchedules.sort((a, b) => a.startTime.localeCompare(b.startTime));
        return { ...sorted[0], day: '오늘' };
    }
    
    // 다음 요일 스케줄
    for (let i = 1; i <= 7; i++) {
        const checkDay = (currentDay + i) % 7;
        const daySchedules = enabledSchedules.filter(s => s.days.includes(checkDay));
        
        if (daySchedules.length > 0) {
            const sorted = daySchedules.sort((a, b) => a.startTime.localeCompare(b.startTime));
            const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
            return {
                ...sorted[0],
                day: dayNames[checkDay]
            };
        }
    }
    
    return null;
}

function getNextLEDSchedule() {
    const now = new Date();
    const currentDay = (now.getDay() + 6) % 7;
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    const enabledSchedules = ledSchedules.filter(s => s.enabled);
    if (enabledSchedules.length === 0) return null;
    
    const allEvents = [];
    const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
    
    enabledSchedules.forEach(schedule => {
        schedule.days.forEach(day => {
            const [onHour, onMin] = schedule.onTime.split(':').map(Number);
            const [offHour, offMin] = schedule.offTime.split(':').map(Number);
            const onTime = onHour * 60 + onMin;
            const offTime = offHour * 60 + offMin;
            
            allEvents.push({
                day,
                time: schedule.onTime,
                minutes: onTime,
                action: 'ON',
                leds: schedule.leds
            });
            
            allEvents.push({
                day,
                time: schedule.offTime,
                minutes: offTime,
                action: 'OFF',
                leds: schedule.leds
            });
        });
    });
    
    // 오늘 남은 이벤트
    const todayEvents = allEvents.filter(e => e.day === currentDay && e.minutes > currentTime);
    if (todayEvents.length > 0) {
        const sorted = todayEvents.sort((a, b) => a.minutes - b.minutes);
        return { ...sorted[0], day: '오늘' };
    }
    
    // 다음 요일 이벤트
    for (let i = 1; i <= 7; i++) {
        const checkDay = (currentDay + i) % 7;
        const dayEvents = allEvents.filter(e => e.day === checkDay);
        
        if (dayEvents.length > 0) {
            const sorted = dayEvents.sort((a, b) => a.minutes - b.minutes);
            return { ...sorted[0], day: dayNames[checkDay] };
        }
    }
    
    return null;
}

// 스케줄 토글
function toggleMotorSchedule(id) {
    const schedule = motorSchedules.find(s => s.id === id);
    if (schedule) {
        schedule.enabled = !schedule.enabled;
        localStorage.setItem(MOTOR_SCHEDULE_KEY, JSON.stringify(motorSchedules));
        updateMotorScheduleList();
        updateMotorSchedulePreview();
        addLog(`모터 스케줄 ${schedule.enabled ? '활성화' : '비활성화'}`, 'info');
    }
}

function toggleLEDSchedule(id) {
    const schedule = ledSchedules.find(s => s.id === id);
    if (schedule) {
        schedule.enabled = !schedule.enabled;
        localStorage.setItem(LED_SCHEDULE_KEY, JSON.stringify(ledSchedules));
        updateLEDScheduleList();
        updateLEDSchedulePreview();
        addLog(`LED 스케줄 ${schedule.enabled ? '활성화' : '비활성화'}`, 'info');
    }
}

// 스케줄 삭제
function deleteMotorSchedule(id) {
    if (confirm('이 스케줄을 삭제하시겠습니까?')) {
        motorSchedules = motorSchedules.filter(s => s.id !== id);
        localStorage.setItem(MOTOR_SCHEDULE_KEY, JSON.stringify(motorSchedules));
        updateMotorScheduleList();
        updateMotorSchedulePreview();
        addLog('모터 스케줄 삭제됨', 'info');
    }
}

function deleteLEDSchedule(id) {
    if (confirm('이 스케줄을 삭제하시겠습니까?')) {
        ledSchedules = ledSchedules.filter(s => s.id !== id);
        localStorage.setItem(LED_SCHEDULE_KEY, JSON.stringify(ledSchedules));
        updateLEDScheduleList();
        updateLEDSchedulePreview();
        addLog('LED 스케줄 삭제됨', 'info');
    }
}

// 자동 모드 설정
function setMotorAutoMode() {
    motorAutoMode = true;
    localStorage.setItem(MOTOR_MODE_KEY, JSON.stringify(motorAutoMode));
    updateMotorModeDisplay();
    updateMotorSchedulePreview();
    addLog('모터 자동 모드로 전환', 'success');
}

function setLEDAutoMode() {
    ledAutoMode = true;
    localStorage.setItem(LED_MODE_KEY, JSON.stringify(ledAutoMode));
    updateLEDModeDisplay();
    updateLEDSchedulePreview();
    addLog('LED 자동 모드로 전환', 'success');
}

// 모드 표시 업데이트
function updateMotorModeDisplay() {
    const badge = document.getElementById('motor-mode-badge');
    const btn = document.getElementById('motor-auto-btn');
    
    if (motorAutoMode) {
        badge.textContent = '🟢 자동 모드';
        badge.classList.remove('manual');
        badge.classList.add('auto');
        btn.style.display = 'none';
    } else {
        badge.textContent = '🔴 수동 모드';
        badge.classList.remove('auto');
        badge.classList.add('manual');
        btn.style.display = 'inline-block';
    }
}

function updateLEDModeDisplay() {
    const badge = document.getElementById('led-mode-badge');
    const btn = document.getElementById('led-auto-btn');
    
    if (ledAutoMode) {
        badge.textContent = '🟢 자동 모드';
        badge.classList.remove('manual');
        badge.classList.add('auto');
        btn.style.display = 'none';
    } else {
        badge.textContent = '🔴 수동 모드';
        badge.classList.remove('auto');
        badge.classList.add('manual');
        btn.style.display = 'inline-block';
    }
}

// 스케줄 체크 및 실행
function checkSchedules() {
    const now = new Date();
    const currentDay = (now.getDay() + 6) % 7;
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    // 모터 스케줄 체크
    if (motorAutoMode) {
        motorSchedules.forEach(schedule => {
            if (!schedule.enabled || !schedule.days.includes(currentDay)) return;
            
            if (currentTime === schedule.startTime) {
                executeMotorSchedule(schedule);
            } else if (currentTime === schedule.endTime) {
                stopMotorSchedule();
            }
        });
    }
    
    // LED 스케줄 체크
    if (ledAutoMode) {
        ledSchedules.forEach(schedule => {
            if (!schedule.enabled || !schedule.days.includes(currentDay)) return;
            
            if (currentTime === schedule.onTime) {
                executeLEDSchedule(schedule, true);
            } else if (currentTime === schedule.offTime) {
                executeLEDSchedule(schedule, false);
            }
        });
    }
    
    // 프리뷰 업데이트
    updateMotorSchedulePreview();
    updateLEDSchedulePreview();
}

// 스케줄 실행
async function executeMotorSchedule(schedule) {
    addLog(`스케줄 실행: 모터 속도${schedule.speed} ${schedule.direction === 'forward' ? '정회전' : '역회전'}`, 'success');
    await setMotorSpeed(schedule.speed);
    await setMotorDirection(schedule.direction);
}

function stopMotorSchedule() {
    addLog('스케줄 종료: 모터 정지', 'info');
    setMotorDirection('stop');
}

async function executeLEDSchedule(schedule, turnOn) {
    const action = turnOn ? 'ON' : 'OFF';
    addLog(`스케줄 실행: LED ${schedule.leds.map(l => l - 9).join(', ')} ${action}`, 'success');
    
    for (const ledNum of schedule.leds) {
        const btn = document.querySelector(`.btn-led[data-relay="${ledNum}"]`);
        if (btn) {
            if (turnOn) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
            systemData.relays[ledNum] = turnOn;
            
            try {
                await fetch(`/api/relay/${ledNum}?state=${turnOn}`, { method: 'POST' });
            } catch (error) {
                console.error(`Failed to control LED ${ledNum}:`, error);
            }
        }
    }
}

// ========== 전력 사용량 차트 및 데이터 관리 ==========

// 전력 사용량 차트 초기화
function initEnergyCharts() {
    // 시간별 전력 사용량 차트
    const energyHourlyCtx = document.getElementById('energyHourlyChart')?.getContext('2d');
    if (energyHourlyCtx) {
        energyHourlyChart = new Chart(energyHourlyCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: '시간별 사용량 (kWh)',
                    data: [],
                    backgroundColor: 'rgba(52, 152, 219, 0.6)',
                    borderColor: '#3498db',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '시간별 전력 사용량 (kWh)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return '사용량: ' + context.parsed.y.toFixed(3) + ' kWh';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#ecf0f1' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        title: {
                            display: true,
                            text: 'kWh',
                            color: '#ecf0f1'
                        }
                    },
                    x: {
                        ticks: { 
                            color: '#ecf0f1',
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
    
    // 일별 전력 사용량 차트
    const energyDailyCtx = document.getElementById('energyDailyChart')?.getContext('2d');
    if (energyDailyCtx) {
        energyDailyChart = new Chart(energyDailyCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: '일별 사용량 (kWh)',
                    data: [],
                    backgroundColor: 'rgba(46, 204, 113, 0.6)',
                    borderColor: '#2ecc71',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '일별 전력 사용량 (kWh)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return '사용량: ' + context.parsed.y.toFixed(2) + ' kWh';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#ecf0f1' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        title: {
                            display: true,
                            text: 'kWh',
                            color: '#ecf0f1'
                        }
                    },
                    x: {
                        ticks: { 
                            color: '#ecf0f1',
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
    
    // 월별 전력 사용량 차트
    const energyMonthlyCtx = document.getElementById('energyMonthlyChart')?.getContext('2d');
    if (energyMonthlyCtx) {
        energyMonthlyChart = new Chart(energyMonthlyCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: '월별 사용량 (kWh)',
                    data: [],
                    backgroundColor: 'rgba(243, 156, 18, 0.6)',
                    borderColor: '#f39c12',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '월별 전력 사용량 (kWh)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return '사용량: ' + context.parsed.y.toFixed(1) + ' kWh';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#ecf0f1' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        title: {
                            display: true,
                            text: 'kWh',
                            color: '#ecf0f1'
                        }
                    },
                    x: {
                        ticks: { 
                            color: '#ecf0f1'
                        },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
}

// 전력 차트 데이터 로드
async function loadEnergyCharts() {
    try {
        // 시간별 데이터 로드 (오늘)
        const today = new Date().toISOString().split('T')[0];
        const hourlyResponse = await fetch(`/api/db/energy/hourly?date=${today}`);
        if (hourlyResponse.ok) {
            const hourlyResult = await hourlyResponse.json();
            updateEnergyHourlyChart(hourlyResult.data);
        }
        
        // 일별 데이터 로드 (최근 30일)
        const dailyResponse = await fetch('/api/db/energy/daily?limit=30');
        if (dailyResponse.ok) {
            const dailyResult = await dailyResponse.json();
            updateEnergyDailyChart(dailyResult.data);
        }
        
        // 월별 데이터 로드 (최근 12개월)
        const monthlyResponse = await fetch('/api/db/energy/monthly?limit=12');
        if (monthlyResponse.ok) {
            const monthlyResult = await monthlyResponse.json();
            updateEnergyMonthlyChart(monthlyResult.data);
        }
        
        // 실시간 전력 데이터 로드
        const realtimeResponse = await fetch('/api/db/power_realtime?limit=50');
        if (realtimeResponse.ok) {
            const realtimeResult = await realtimeResponse.json();
            updatePowerRealtimeChart(realtimeResult.data);
        }
        
    } catch (error) {
        console.error('Failed to load energy charts:', error);
    }
}

// 시간별 차트 업데이트
function updateEnergyHourlyChart(data) {
    if (!energyHourlyChart || !data || data.length === 0) return;
    
    // 시간 순서대로 정렬
    data.sort((a, b) => a.hour - b.hour);
    
    const labels = data.map(d => `${d.hour}시`);
    const values = data.map(d => d.energy_kwh);
    
    energyHourlyChart.data.labels = labels;
    energyHourlyChart.data.datasets[0].data = values;
    energyHourlyChart.update('none');
}

// 일별 차트 업데이트
function updateEnergyDailyChart(data) {
    if (!energyDailyChart || !data || data.length === 0) return;
    
    // 역순 정렬 (날짜 순서대로)
    data.reverse();
    
    const labels = data.map(d => {
        const date = new Date(d.date);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    });
    const values = data.map(d => d.energy_kwh);
    
    energyDailyChart.data.labels = labels;
    energyDailyChart.data.datasets[0].data = values;
    energyDailyChart.update('none');
}

// 월별 차트 업데이트
function updateEnergyMonthlyChart(data) {
    if (!energyMonthlyChart || !data || data.length === 0) return;
    
    // 역순 정렬 (날짜 순서대로)
    data.reverse();
    
    const labels = data.map(d => `${d.year}년 ${d.month}월`);
    const values = data.map(d => d.energy_kwh);
    
    energyMonthlyChart.data.labels = labels;
    energyMonthlyChart.data.datasets[0].data = values;
    energyMonthlyChart.update('none');
}

// 실시간 전력 차트 업데이트
function updatePowerRealtimeChart(data) {
    if (!powerChart || !data || data.length === 0) return;
    
    // 역순 정렬 (시간 순서대로)
    data.reverse();
    
    const labels = data.map(d => {
        const time = new Date(d.timestamp);
        return time.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit'
        });
    });
    const values = data.map(d => d.power || 0);
    
    powerChart.data.labels = labels;
    powerChart.data.datasets[0].data = values;
    powerChart.update('none');
}

// 전력 요금 계산 (한국전력 누진제 기준)
function calculateElectricityCost(kwh) {
    let cost = 0;
    if (kwh <= 200) {
        cost = kwh * 93.3;
    } else if (kwh <= 400) {
        cost = 200 * 93.3 + (kwh - 200) * 187.9;
    } else {
        cost = 200 * 93.3 + 200 * 187.9 + (kwh - 400) * 280.6;
    }
    
    // 기본요금
    cost += 1000;
    
    // 부가세 10%
    cost *= 1.1;
    
    return Math.round(cost);
}

// 전력 사용량 데이터 로드
async function loadEnergyUsageData() {
    try {
        // 시간별 데이터
        const today = new Date().toISOString().split('T')[0];
        const hourlyResponse = await fetch(`/api/db/energy/hourly?date=${today}`);
        if (hourlyResponse.ok) {
            const hourlyResult = await hourlyResponse.json();
            updateEnergyHourlyTable(hourlyResult.data);
        }
        
        // 일별 데이터
        const dailyResponse = await fetch('/api/db/energy/daily?limit=30');
        if (dailyResponse.ok) {
            const dailyResult = await dailyResponse.json();
            updateEnergyDailyTable(dailyResult.data);
        }
        
        // 월별 데이터
        const monthlyResponse = await fetch('/api/db/energy/monthly?limit=12');
        if (monthlyResponse.ok) {
            const monthlyResult = await monthlyResponse.json();
            updateEnergyMonthlyTable(monthlyResult.data);
        }
        
        // 통계 업데이트
        updateEnergyStats();
        
    } catch (error) {
        console.error('Failed to load energy usage data:', error);
    }
}

// 시간별 테이블 업데이트
function updateEnergyHourlyTable(data) {
    const tbody = document.getElementById('energy-hourly-body');
    if (!tbody) return;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">데이터 없음</td></tr>';
        return;
    }
    
    // 시간 순서대로 정렬
    data.sort((a, b) => a.hour - b.hour);
    
    tbody.innerHTML = data.map(row => `
        <tr>
            <td>${row.hour}:00 ~ ${row.hour}:59</td>
            <td><strong>${row.energy_kwh.toFixed(3)}</strong></td>
            <td>${row.avg_power ? row.avg_power.toFixed(1) : '-'}</td>
        </tr>
    `).join('');
}

// 일별 테이블 업데이트
function updateEnergyDailyTable(data) {
    const tbody = document.getElementById('energy-daily-body');
    if (!tbody) return;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">데이터 없음</td></tr>';
        return;
    }
    
    // 날짜 역순 정렬 (최신부터)
    data.sort((a, b) => b.date.localeCompare(a.date));
    
    tbody.innerHTML = data.map(row => {
        const cost = calculateElectricityCost(row.energy_kwh);
        return `
            <tr>
                <td>${row.date}</td>
                <td><strong>${row.energy_kwh.toFixed(3)}</strong></td>
                <td>${row.avg_power ? row.avg_power.toFixed(1) : '-'}</td>
                <td style="color: var(--color-warning);">${cost.toLocaleString()} 원</td>
            </tr>
        `;
    }).join('');
}

// 월별 테이블 업데이트
function updateEnergyMonthlyTable(data) {
    const tbody = document.getElementById('energy-monthly-body');
    if (!tbody) return;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">데이터 없음</td></tr>';
        return;
    }
    
    // 년월 역순 정렬 (최신부터)
    data.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
    });
    
    tbody.innerHTML = data.map(row => {
        const cost = calculateElectricityCost(row.energy_kwh);
        return `
            <tr>
                <td>${row.year}년 ${row.month}월</td>
                <td><strong>${row.energy_kwh.toFixed(2)}</strong></td>
                <td>${row.avg_power ? row.avg_power.toFixed(1) : '-'}</td>
                <td style="color: var(--color-warning); font-weight: bold;">
                    ${cost.toLocaleString()} 원
                </td>
            </tr>
        `;
    }).join('');
}

// 통계 업데이트
async function updateEnergyStats() {
    try {
        // 오늘 사용량
        const today = new Date().toISOString().split('T')[0];
        const todayResponse = await fetch(`/api/db/energy/daily?start_date=${today}&end_date=${today}`);
        if (todayResponse.ok) {
            const todayResult = await todayResponse.json();
            const todayUsage = todayResult.data.length > 0 ? todayResult.data[0].energy_kwh : 0;
            const statToday = document.getElementById('stat-today');
            if (statToday) {
                statToday.textContent = `${todayUsage.toFixed(2)} kWh`;
            }
        }
        
        // 이번 달 사용량
        const now = new Date();
        const monthResponse = await fetch(`/api/db/energy/monthly?year=${now.getFullYear()}`);
        if (monthResponse.ok) {
            const monthResult = await monthResponse.json();
            const thisMonth = monthResult.data.find(d => d.month === now.getMonth() + 1);
            const monthUsage = thisMonth ? thisMonth.energy_kwh : 0;
            const statMonth = document.getElementById('stat-month');
            if (statMonth) {
                statMonth.textContent = `${monthUsage.toFixed(2)} kWh`;
            }
            
            // 예상 월 요금
            const monthlyCost = calculateElectricityCost(monthUsage);
            const statMonthlyCost = document.getElementById('stat-monthly-cost');
            if (statMonthlyCost) {
                statMonthlyCost.textContent = `${monthlyCost.toLocaleString()} 원`;
            }
        }
        
        // 평균 일일 사용량 (최근 30일)
        const dailyResponse = await fetch('/api/db/energy/daily?limit=30');
        if (dailyResponse.ok) {
            const dailyResult = await dailyResponse.json();
            if (dailyResult.data.length > 0) {
                const totalUsage = dailyResult.data.reduce((sum, d) => sum + d.energy_kwh, 0);
                const avgDaily = totalUsage / dailyResult.data.length;
                const statDailyAvg = document.getElementById('stat-daily-avg');
                if (statDailyAvg) {
                    statDailyAvg.textContent = `${avgDaily.toFixed(2)} kWh`;
                }
            }
        }
        
    } catch (error) {
        console.error('Failed to update energy stats:', error);
    }
}

// CSV 다운로드 함수들
async function downloadEnergyHourly() {
    try {
        const response = await fetch('/api/db/export/energy_hourly');
        if (!response.ok) throw new Error('다운로드 실패');
        
        const result = await response.json();
        downloadFile(result.csv, 'energy_hourly.csv', 'text/csv');
    } catch (error) {
        alert('시간별 전력 사용량 다운로드에 실패했습니다.');
        console.error(error);
    }
}

async function downloadEnergyDaily() {
    try {
        const response = await fetch('/api/db/export/energy_daily');
        if (!response.ok) throw new Error('다운로드 실패');
        
        const result = await response.json();
        downloadFile(result.csv, 'energy_daily.csv', 'text/csv');
    } catch (error) {
        alert('일별 전력 사용량 다운로드에 실패했습니다.');
        console.error(error);
    }
}

async function downloadEnergyMonthly() {
    try {
        const response = await fetch('/api/db/export/energy_monthly');
        if (!response.ok) throw new Error('다운로드 실패');
        
        const result = await response.json();
        downloadFile(result.csv, 'energy_monthly.csv', 'text/csv');
    } catch (error) {
        alert('월별 전력 사용량 다운로드에 실패했습니다.');
        console.error(error);
    }
}

// ========== 메인 탭 전환 함수 ==========

/**
 * 메인 탭 전환 (대시보드 / 데이터 분석 / 스케줄)
 */
function switchMainTab(tabName) {
    // 모든 메인 탭 버튼과 컨텐츠 비활성화
    document.querySelectorAll('.main-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.main-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // 선택된 탭 활성화
    event.target.classList.add('active');
    document.getElementById(tabName + '-main-tab').classList.add('active');
    
    // 차트가 있는 탭이면 리사이즈
    if (tabName === 'data-analysis') {
        setTimeout(() => {
            resizeAllCharts();
        }, 100);
    }
}

/**
 * 서브 탭 전환 (데이터 분석 탭 내부)
 */
function switchTab(tabName) {
    // 모든 서브 탭 버튼과 컨텐츠 비활성화
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // 선택된 서브 탭 활성화
    event.target.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');
    
    // 그래프 탭이면 차트 리사이즈
    if (tabName === 'charts') {
        setTimeout(() => {
            resizeAllCharts();
        }, 100);
    }
    
    // 전력 사용량 탭이면 데이터 로드
    if (tabName === 'energy-usage') {
        loadEnergyUsageData();
    }
}

/**
 * 모든 차트 리사이즈
 */
function resizeAllCharts() {
    if (temperatureChart) temperatureChart.resize();
    if (humidityChart) humidityChart.resize();
    if (co2Chart) co2Chart.resize();
    if (luxChart) luxChart.resize();
    if (powerChart) powerChart.resize();
    if (energyChart) energyChart.resize();
    if (energyHourlyChart) energyHourlyChart.resize();
    if (energyDailyChart) energyDailyChart.resize();
    if (energyMonthlyChart) energyMonthlyChart.resize();
}

// 이 파일을 기존 app.js에 추가하거나, 
// HTML에서 <script src="/static/js/app_tab_functions.js"></script>로 별도 로드