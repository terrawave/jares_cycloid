// ========== ì›¹ ìƒˆë¡œê³ ì¹¨ ì‹œ ë¦´ë ˆì´ ìƒíƒœ ìœ ì§€ ë¬¸ì œ í•´ê²° ==========
// ìˆ˜ì • ì‚¬í•­:
// 1. WebSocket ì—°ê²° ì™„ë£Œ í›„ ì„œë²„ ìƒíƒœ ë¡œë“œ
// 2. ì„œë²„ ìƒíƒœì™€ ë¡œì»¬ ì €ìž¥ ìƒíƒœ ë¹„êµí•˜ì—¬ í•„ìš”í•œ ê²½ìš°ì—ë§Œ ë³µì›
// 3. ë¶ˆí•„ìš”í•œ ë¦´ë ˆì´ í† ê¸€ ë°©ì§€

// WebSocket ì—°ê²°
let ws = null;
let reconnectInterval = null;
let systemData = {
    relays: Array(16).fill(false),
    slaves: [],
    master: {},
    water_running: false
};

// ì°¨íŠ¸ ì´ˆê¸°í™”
let temperatureChart = null;
let humidityChart = null;
let co2Chart = null;
let luxChart = null;
let powerChart = null;
let energyChart = null;
let energyHourlyChart = null;
let energyDailyChart = null;
let energyMonthlyChart = null;
const maxDataPoints = 50; // ë°ì´í„°ë² ì´ìŠ¤ ê¸°ë°˜ì´ë¯€ë¡œ ë” ë§Žì€ í¬ì¸íŠ¸ í‘œì‹œ

// ì°¨íŠ¸ ë°ì´í„° ì €ìž¥ì†Œ
let chartDataStore = {
    temperature: {},
    humidity: {},
    co2: {},
    lux: {},
    power: [],
    energy: [],
    labels: []
};

// ëª¨í„° ì œì–´ ìƒíƒœ
let currentMotorSpeed = 0;
let currentMotorDirection = 'stop';

// localStorage í‚¤
const STORAGE_KEY = 'esp32_relay_state';

// ë°ì´í„° ì €ìž¥ ë°°ì—´ (ë©”ëª¨ë¦¬ì—ë§Œ ìœ ì§€)
let sensorDataLog = [];
let relayLog = [];
let systemLog = [];

// ì´ˆê¸°í™” ìƒíƒœ í”Œëž˜ê·¸
let serverStateLoaded = false;

// ========== ìŠ¤ì¼€ì¤„ ê´€ë¦¬ ==========
const MOTOR_SCHEDULE_KEY = 'esp32_motor_schedules';
const LED_SCHEDULE_KEY = 'esp32_led_schedules';
const MOTOR_MODE_KEY = 'esp32_motor_auto_mode';
const LED_MODE_KEY = 'esp32_led_auto_mode';

let motorSchedules = [];
let ledSchedules = [];
let motorAutoMode = true;
let ledAutoMode = true;
let scheduleCheckInterval = null;

// âœ… ìˆ˜ì •ëœ ì´ˆê¸°í™”
document.addEventListener('DOMContentLoaded', () => {
    initRelayGrid();
    initCharts();
    initEnergyCharts();
    
    // ë°ì´í„°ë² ì´ìŠ¤ì—ì„œ ë°ì´í„° ë¡œë“œ
    loadStoredData();
    
    // ì°¨íŠ¸ ížˆìŠ¤í† ë¦¬ ë°ì´í„° ë¡œë“œ
    loadChartHistory();
    
    // ì „ë ¥ ì‚¬ìš©ëŸ‰ ë°ì´í„° ë¡œë“œ
    loadEnergyCharts();
    loadEnergyUsageData();
    
    // WebSocket ì´ˆê¸°í™”
    initWebSocket();
    
    // ìŠ¤ì¼€ì¤„ ë¡œë“œ
    loadSchedules();
    
    // 1ë¶„ë§ˆë‹¤ ì°¨íŠ¸ ë°ì´í„° ìƒˆë¡œê³ ì¹¨ (ì„œë²„ê°€ 1ë¶„ë§ˆë‹¤ ë°ì´í„°ë² ì´ìŠ¤ì— ì €ìž¥í•˜ë¯€ë¡œ)
    setInterval(() => {
        loadChartHistory();
    }, 60000); // 60ì´ˆ
    
    // 5ë¶„ë§ˆë‹¤ ì „ë ¥ ì°¨íŠ¸ ì—…ë°ì´íŠ¸
    setInterval(() => {
        loadEnergyCharts();
    }, 300000);
    
    // 10ë¶„ë§ˆë‹¤ ì „ë ¥ ì‚¬ìš©ëŸ‰ ë°ì´í„° ì—…ë°ì´íŠ¸
    setInterval(() => {
        loadEnergyUsageData();
    }, 600000);
});

// íƒ­ ì „í™˜ í•¨ìˆ˜
function switchTab(tabName) {
    // ëª¨ë“  íƒ­ ë²„íŠ¼ê³¼ ì»¨í…ì¸  ë¹„í™œì„±í™”
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // ì„ íƒëœ íƒ­ í™œì„±í™”
    event.target.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');
    
    // ê·¸ëž˜í”„ íƒ­ì´ë©´ ì°¨íŠ¸ ë¦¬ì‚¬ì´ì¦ˆ
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
    
    // ì „ë ¥ ì‚¬ìš©ëŸ‰ íƒ­ì´ë©´ ë°ì´í„° ë¡œë“œ
    if (tabName === 'energy-usage') {
        loadEnergyUsageData();
    }
}

// ========== ë°ì´í„°ë² ì´ìŠ¤ì—ì„œ ì°¨íŠ¸ ížˆìŠ¤í† ë¦¬ ë¡œë“œ ==========
async function loadChartHistory() {
    try {
        // ìµœê·¼ 50ê°œ ì„¼ì„œ ë°ì´í„° ê°€ì ¸ì˜¤ê¸°
        const sensorResponse = await fetch('/api/db/sensor_data?limit=50');
        if (!sensorResponse.ok) throw new Error('Failed to load sensor history');
        
        const sensorResult = await sensorResponse.json();
        const sensorData = sensorResult.data || [];
        
        // ìµœê·¼ 50ê°œ ì „ë ¥ ë°ì´í„° ê°€ì ¸ì˜¤ê¸°
        const powerResponse = await fetch('/api/db/power_realtime?limit=50');
        if (!powerResponse.ok) throw new Error('Failed to load power history');
        
        const powerResult = await powerResponse.json();
        const powerData = powerResult.data || [];
        
        // ì„¼ì„œ ë°ì´í„° ì²˜ë¦¬ (ì‹œê°„ ì—­ìˆœìœ¼ë¡œ ì •ë ¬)
        sensorData.reverse();
        
        // ë””ë°”ì´ìŠ¤ë³„ë¡œ ë°ì´í„° ê·¸ë£¹í™”
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
        
        // ì°¨íŠ¸ ë°ì´í„° ì €ìž¥ì†Œ ì—…ë°ì´íŠ¸
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
            
            // ë ˆì´ë¸”ì€ ì²« ë²ˆì§¸ ë””ë°”ì´ìŠ¤ì˜ ê²ƒì„ ì‚¬ìš©
            if (chartDataStore.labels.length === 0) {
                chartDataStore.labels = deviceData[device].labels;
            }
        });
        
        // ì „ë ¥ ë°ì´í„° ì²˜ë¦¬ (ì‹œê°„ ì—­ìˆœìœ¼ë¡œ ì •ë ¬)
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
        
        // ì°¨íŠ¸ ì—…ë°ì´íŠ¸
        updateChartsFromStore();
        
        addLog('ì°¨íŠ¸ ížˆìŠ¤í† ë¦¬ ë°ì´í„° ë¡œë“œ ì™„ë£Œ', 'success');
    } catch (error) {
        console.error('Failed to load chart history:', error);
        addLog('ì°¨íŠ¸ ížˆìŠ¤í† ë¦¬ ë¡œë“œ ì‹¤íŒ¨: ' + error.message, 'error');
    }
}

// ========== ë°ì´í„°ë² ì´ìŠ¤ì—ì„œ ë°ì´í„° ë¡œë“œ ==========
async function loadStoredData() {
    try {
        // ì„¼ì„œ ë°ì´í„° ë¡œë“œ
        const sensorResponse = await fetch('/api/db/sensor_data?limit=100');
        if (sensorResponse.ok) {
            const sensorResult = await sensorResponse.json();
            sensorDataLog = sensorResult.data || [];
            updateSensorDataTable();
        }
        
        // ë¦´ë ˆì´ ë¡œê·¸ ë¡œë“œ
        const relayResponse = await fetch('/api/db/relay_logs?limit=100');
        if (relayResponse.ok) {
            const relayResult = await relayResponse.json();
            relayLog = relayResult.logs || [];
            updateRelayLogTable();
        }
        
        // ì‹œìŠ¤í…œ ë¡œê·¸ ë¡œë“œ
        const systemResponse = await fetch('/api/db/system_logs?limit=100');
        if (systemResponse.ok) {
            const systemResult = await systemResponse.json();
            systemLog = systemResult.logs || [];
            updateSystemLogDisplay();
        }
    } catch (error) {
        console.error('Failed to load data from database:', error);
        addLog('ë°ì´í„°ë² ì´ìŠ¤ì—ì„œ ë°ì´í„° ë¡œë“œ ì‹¤íŒ¨', 'error');
    }
}

// ì„¼ì„œ ë°ì´í„° í…Œì´ë¸” ì—…ë°ì´íŠ¸
function updateSensorDataTable() {
    const tbody = document.getElementById('sensor-data-body');
    const count = document.getElementById('sensor-data-count');
    
    if (!tbody) return;
    
    count.textContent = sensorDataLog.length;
    
    // ìµœê·¼ 100ê°œë§Œ í‘œì‹œ
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

// ë¦´ë ˆì´ ë¡œê·¸ ì¶”ê°€ (localStorage ì €ìž¥ ì œê±°)
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
    
    // localStorage ì €ìž¥ ì œê±° - ì„œë²„ì—ì„œ ìžë™ ì €ìž¥ë¨
    updateRelayLogTable();
}

// ë¦´ë ˆì´ ë¡œê·¸ í…Œì´ë¸” ì—…ë°ì´íŠ¸
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

// ì‹œìŠ¤í…œ ë¡œê·¸ í‘œì‹œ ì—…ë°ì´íŠ¸
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

// ========== CSV ë‹¤ìš´ë¡œë“œ í•¨ìˆ˜ (ë°ì´í„°ë² ì´ìŠ¤ API ì‚¬ìš©) ==========
async function downloadSensorData() {
    try {
        const response = await fetch('/api/db/export/sensor_data');
        if (!response.ok) throw new Error('ë‹¤ìš´ë¡œë“œ ì‹¤íŒ¨');
        
        const result = await response.json();
        downloadFile(result.csv, 'sensor_data.csv', 'text/csv');
    } catch (error) {
        alert('ì„¼ì„œ ë°ì´í„° ë‹¤ìš´ë¡œë“œì— ì‹¤íŒ¨í–ˆìŠµë‹ˆë‹¤.');
        console.error(error);
    }
}

function downloadSystemLogs() {
    // ì‹œìŠ¤í…œ ë¡œê·¸ëŠ” ë©”ëª¨ë¦¬ì—ì„œ ë‹¤ìš´ë¡œë“œ
    if (systemLog.length === 0) {
        alert('ë‹¤ìš´ë¡œë“œí•  ë¡œê·¸ê°€ ì—†ìŠµë‹ˆë‹¤.');
        return;
    }
    
    let txt = systemLog.map(log => log.message).join('\n');
    downloadFile(txt, 'system_logs.txt', 'text/plain');
}

async function downloadRelayLogs() {
    try {
        const response = await fetch('/api/db/export/relay_logs');
        if (!response.ok) throw new Error('ë‹¤ìš´ë¡œë“œ ì‹¤íŒ¨');
        
        const result = await response.json();
        downloadFile(result.csv, 'relay_logs.csv', 'text/csv');
    } catch (error) {
        alert('ë¦´ë ˆì´ ë¡œê·¸ ë‹¤ìš´ë¡œë“œì— ì‹¤íŒ¨í–ˆìŠµë‹ˆë‹¤.');
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

// ========== ë°ì´í„° ì‚­ì œ í•¨ìˆ˜ (ë°ì´í„°ë² ì´ìŠ¤ API ì‚¬ìš©) ==========
async function clearSensorData() {
    if (confirm('ëª¨ë“  ì„¼ì„œ ë°ì´í„°ë¥¼ ì‚­ì œí•˜ì‹œê² ìŠµë‹ˆê¹Œ?')) {
        try {
            const response = await fetch('/api/db/sensor_data', { method: 'DELETE' });
            if (!response.ok) throw new Error('ì‚­ì œ ì‹¤íŒ¨');
            
            sensorDataLog = [];
            updateSensorDataTable();
            // ì°¨íŠ¸ë„ ì´ˆê¸°í™”
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
            addLog('ì„¼ì„œ ë°ì´í„°ê°€ ì‚­ì œë˜ì—ˆìŠµë‹ˆë‹¤', 'info');
        } catch (error) {
            alert('ì„¼ì„œ ë°ì´í„° ì‚­ì œì— ì‹¤íŒ¨í–ˆìŠµë‹ˆë‹¤.');
            console.error(error);
        }
    }
}

async function clearSystemLogs() {
    if (confirm('ëª¨ë“  ì‹œìŠ¤í…œ ë¡œê·¸ë¥¼ ì‚­ì œí•˜ì‹œê² ìŠµë‹ˆê¹Œ?')) {
        try {
            const response = await fetch('/api/db/system_logs', { method: 'DELETE' });
            if (!response.ok) throw new Error('ì‚­ì œ ì‹¤íŒ¨');
            
            systemLog = [];
            updateSystemLogDisplay();
            addLog('ì‹œìŠ¤í…œ ë¡œê·¸ê°€ ì‚­ì œë˜ì—ˆìŠµë‹ˆë‹¤', 'info');
        } catch (error) {
            alert('ì‹œìŠ¤í…œ ë¡œê·¸ ì‚­ì œì— ì‹¤íŒ¨í–ˆìŠµë‹ˆë‹¤.');
            console.error(error);
        }
    }
}

async function clearRelayLogs() {
    if (confirm('ëª¨ë“  ë¦´ë ˆì´ ì œì–´ ë¡œê·¸ë¥¼ ì‚­ì œí•˜ì‹œê² ìŠµë‹ˆê¹Œ?')) {
        try {
            const response = await fetch('/api/db/relay_logs', { method: 'DELETE' });
            if (!response.ok) throw new Error('ì‚­ì œ ì‹¤íŒ¨');
            
            relayLog = [];
            updateRelayLogTable();
            addLog('ë¦´ë ˆì´ ë¡œê·¸ê°€ ì‚­ì œë˜ì—ˆìŠµë‹ˆë‹¤', 'info');
        } catch (error) {
            alert('ë¦´ë ˆì´ ë¡œê·¸ ì‚­ì œì— ì‹¤íŒ¨í–ˆìŠµë‹ˆë‹¤.');
            console.error(error);
        }
    }
}

// âœ… ìˆ˜ì •ëœ WebSocket ì´ˆê¸°í™”
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
        
        // âœ… WebSocket ì—°ê²° í›„ ì„œë²„ ìƒíƒœ ë¡œë“œ
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

// WebSocket ë©”ì‹œì§€ ì²˜ë¦¬
function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'initial_status':
        case 'status_update':
            updateSystemStatus(message.data);
            break;
        case 'command_response':
            addLog(`ì‘ë‹µ: ${message.response}`, 'success');
            break;
        case 'error':
            addLog(`ì—ëŸ¬: ${message.error}`, 'error');
            break;
    }
}

// ì—°ê²° ìƒíƒœ ì—…ë°ì´íŠ¸
function updateConnectionStatus(connected) {
    const indicator = document.getElementById('connection-indicator');
    const text = document.getElementById('connection-text');
    
    if (connected) {
        indicator.classList.add('connected');
        text.textContent = 'ì—°ê²°ë¨';
    } else {
        indicator.classList.remove('connected');
        text.textContent = 'ì—°ê²° ëŠê¹€';
    }
}

// âœ… ìˆ˜ì •ëœ ì‹œìŠ¤í…œ ìƒíƒœ ì—…ë°ì´íŠ¸ í•¨ìˆ˜
function updateSystemStatus(data) {
    systemData = data;
    
    if (data.relays) {
        updateRelayDisplay(data.relays);
        updateMotorControls(data.relays);
        
        // âœ… ì„œë²„ ìƒíƒœê°€ ë¡œë“œë˜ë©´ ì €ìž¥
        if (serverStateLoaded) {
            saveState();
        }
    }
    
    if (data.master) {
        updatePowerMonitor(data.master);
    }
    
    if (data.slaves) {
        updateSlaves(data.slaves);
    }
    
    if (data.water_running !== undefined) {
        updateWaterStatus(data.water_running);
    }
}

// ìƒíƒœ ì €ìž¥
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

// âœ… ìˆ˜ì •ëœ ì €ìž¥ëœ ìƒíƒœ ë³µì›
async function restoreSavedState() {
    try {
        const savedState = localStorage.getItem(STORAGE_KEY);
        if (!savedState) {
            document.querySelector('[data-direction="stop"]')?.classList.add('active');
            addLog('ì €ìž¥ëœ ìƒíƒœ ì—†ìŒ', 'info');
            return;
        }
        
        const state = JSON.parse(savedState);
        const timeDiff = Date.now() - new Date(state.timestamp).getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        
        // 24ì‹œê°„ ì´ë‚´ì˜ ìƒíƒœë§Œ ë³µì›
        if (hoursDiff < 24) {
            // âœ… ì„œë²„ ìƒíƒœì™€ ë¡œì»¬ ì €ìž¥ ìƒíƒœë¥¼ ë¹„êµ
            let needsRestore = false;
            
            // ë¦´ë ˆì´ ìƒíƒœ ë¹„êµ
            for (let i = 0; i < 16; i++) {
                if (systemData.relays[i] !== state.relays[i]) {
                    needsRestore = true;
                    break;
                }
            }
            
            if (needsRestore) {
                addLog(`ì´ì „ ìƒíƒœ ë³µì› ì¤‘... (${Math.floor(hoursDiff)}ì‹œê°„ ì „)`, 'info');
                
                // ëª¨í„° ì†ë„ ë³µì›
                if (state.motorSpeed > 0) {
                    await setMotorSpeed(state.motorSpeed);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // ëª¨í„° ë°©í–¥ ë³µì›
                if (state.motorDirection && state.motorDirection !== 'stop') {
                    await setMotorDirection(state.motorDirection);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // LED ë° ì–‘ì•¡ ë¦´ë ˆì´ ë³µì›
                await restoreRelays(state.relays);
                
                addLog('ìƒíƒœ ë³µì› ì™„ë£Œ', 'success');
            } else {
                addLog('ì„œë²„ ìƒíƒœì™€ ë™ì¼í•¨', 'info');
            }
        } else {
            addLog('ì €ìž¥ëœ ìƒíƒœê°€ ì˜¤ëž˜ë˜ì–´ ë³µì›í•˜ì§€ ì•ŠìŒ', 'info');
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch (error) {
        console.error('Failed to restore state:', error);
        addLog('ìƒíƒœ ë³µì› ì‹¤íŒ¨', 'error');
    }
}

async function restoreRelays(relayStates) {
    // LED ë¦´ë ˆì´ ë³µì› (10, 11, 12)
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
    
    // ì–‘ì•¡ ë¦´ë ˆì´ ë³µì› (3, 4, 5, 6)
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

// ==================== ðŸ”§ ìˆ˜ë™ ì œì–´ ì‹œ ìžë™ ëª¨ë“œ ì „í™˜ ====================

async function toggleLED(relayNum) {
    // ðŸ†• ìžë™ ëª¨ë“œì˜€ë‹¤ë©´ ìˆ˜ë™ ëª¨ë“œë¡œ ì „í™˜
    if (ledAutoMode) {
        ledAutoMode = false;
        localStorage.setItem(LED_MODE_KEY, JSON.stringify(ledAutoMode));
        updateLEDModeDisplay();
        addLog('ìˆ˜ë™ ì œì–´ ê°ì§€ - LED ìˆ˜ë™ ëª¨ë“œë¡œ ì „í™˜', 'info');
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
        addLog(`LED ì œì–´ ì‹¤íŒ¨: ${error.message}`, 'error');
    }
}

async function toggleNutrient(relayNum) {
    const btn = document.querySelector(`.btn-nutrient[data-relay="${relayNum}"]`);
    if (!btn) return;
    
    const currentState = systemData.relays[relayNum];
    const newState = !currentState;
    
    const names = {
        3: 'ë¬¼íƒ±í¬',
        4: 'ê¸‰ìˆ˜ë°¸ë¸Œ',
        5: 'ì–‘ì•¡',
        6: 'ë¬¼ë°¸ë¸Œ'
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
        addLog(`ì–‘ì•¡ ì‹œìŠ¤í…œ ì œì–´ ì‹¤íŒ¨: ${error.message}`, 'error');
    }
}

async function setMotorSpeed(speed) {
    // ðŸ†• ìžë™ ëª¨ë“œì˜€ë‹¤ë©´ ìˆ˜ë™ ëª¨ë“œë¡œ ì „í™˜
    if (motorAutoMode) {
        motorAutoMode = false;
        localStorage.setItem(MOTOR_MODE_KEY, JSON.stringify(motorAutoMode));
        updateMotorModeDisplay();
        addLog('ìˆ˜ë™ ì œì–´ ê°ì§€ - ëª¨í„° ìˆ˜ë™ ëª¨ë“œë¡œ ì „í™˜', 'info');
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
            addLog(`ëª¨í„° ì†ë„ ${speed} ì„¤ì •`, 'success');
            addRelayLog(relayNum, `ëª¨í„° ì†ë„ ${speed}`, true);
        }
    } catch (error) {
        addLog(`ëª¨í„° ì†ë„ ì„¤ì • ì‹¤íŒ¨: ${error.message}`, 'error');
    }
}

async function setMotorDirection(direction) {
    // ðŸ†• ìžë™ ëª¨ë“œì˜€ë‹¤ë©´ ìˆ˜ë™ ëª¨ë“œë¡œ ì „í™˜
    if (motorAutoMode) {
        motorAutoMode = false;
        localStorage.setItem(MOTOR_MODE_KEY, JSON.stringify(motorAutoMode));
        updateMotorModeDisplay();
        addLog('ìˆ˜ë™ ì œì–´ ê°ì§€ - ëª¨í„° ìˆ˜ë™ ëª¨ë“œë¡œ ì „í™˜', 'info');
    }
    
    document.querySelectorAll('.btn-direction').forEach(btn => btn.classList.remove('active'));
    
    const btn = document.querySelector(`.btn-direction[data-direction="${direction}"]`);
    if (btn) btn.classList.add('active');
    
    currentMotorDirection = direction;
    
    const directionNames = {
        'forward': 'ì •íšŒì „',
        'reverse': 'ì—­íšŒì „',
        'stop': 'ì •ì§€'
    };
    
    if (direction === 'forward') {
        systemData.relays[8] = true;
        systemData.relays[9] = false;
        addLog('ëª¨í„° ì •íšŒì „ ì‹œìž‘', 'success');
        addRelayLog(8, directionNames[direction], true);
    } else if (direction === 'reverse') {
        systemData.relays[8] = false;
        systemData.relays[9] = true;
        addLog('ëª¨í„° ì—­íšŒì „ ì‹œìž‘', 'success');
        addRelayLog(9, directionNames[direction], true);
    } else {
        systemData.relays[8] = false;
        systemData.relays[9] = false;
        addLog('ëª¨í„° ì •ì§€', 'info');
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
        addLog(`ëª¨í„° ë°©í–¥ ì„¤ì • ì‹¤íŒ¨: ${error.message}`, 'error');
    }
}

function updatePowerMonitor(data) {
    document.getElementById('voltage').textContent = data.voltage?.toFixed(1) || '0';
    document.getElementById('current').textContent = data.current?.toFixed(3) || '0';
    document.getElementById('power').textContent = data.power?.toFixed(1) || '0';
    document.getElementById('frequency').textContent = data.frequency?.toFixed(1) || '0';
    
    // âœ… ëª¨í„° ì†ë„ê°’
    const motorSpeedAdc = document.getElementById('motor-speed-adc');
    if (motorSpeedAdc) {
        motorSpeedAdc.textContent = data.motor_adc || '0';
    }
    
    // âœ… ê·¼ì ‘ì„¼ì„œ ìƒíƒœ
    const proximitySensor = document.getElementById('proximity-sensor');
    if (proximitySensor) {
        if (data.proximity) {
            proximitySensor.textContent = 'ê°ì§€ë¨';
            proximitySensor.style.color = 'var(--color-success)';
        } else {
            proximitySensor.textContent = 'ë¯¸ê°ì§€';
            proximitySensor.style.color = 'var(--color-danger)';
        }
    }
}

function updateSlaves(slaves) {
    const container = document.getElementById('slaves-container');
    container.innerHTML = '';
    
    if (slaves.length === 0) {
        container.innerHTML = '<p>ì—°ê²°ëœ ì„¼ì„œê°€ ì—†ìŠµë‹ˆë‹¤.</p>';
        return;
    }
    
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
                    <div class="sensor-label">ì˜¨ë„</div>
                    <span class="sensor-value">${slave.temperature?.toFixed(1) || '0'}</span>
                    <span class="sensor-unit">Â°C</span>
                </div>
                <div class="sensor-item">
                    <div class="sensor-label">ìŠµë„</div>
                    <span class="sensor-value">${slave.humidity?.toFixed(1) || '0'}</span>
                    <span class="sensor-unit">%</span>
                </div>
                <div class="sensor-item">
                    <div class="sensor-label">CO2</div>
                    <span class="sensor-value">${slave.co2 || '0'}</span>
                    <span class="sensor-unit">ppm</span>
                </div>
                <div class="sensor-item">
                    <div class="sensor-label">ì¡°ë„</div>
                    <span class="sensor-value">${slave.lux?.toFixed(0) || '0'}</span>
                    <span class="sensor-unit">lux</span>
                </div>
            </div>
        `;
        
        container.appendChild(card);
    });
}

// ì°¨íŠ¸ ì´ˆê¸°í™”
function initCharts() {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
    
    // ì˜¨ë„ ì°¨íŠ¸
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
                        text: 'ì˜¨ë„ (Â°C)',
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
    
    // ìŠµë„ ì°¨íŠ¸
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
                        text: 'ìŠµë„ (%)',
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
    
    // CO2 ì°¨íŠ¸
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
    
    // ì¡°ë„ ì°¨íŠ¸
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
                        text: 'ì¡°ë„ (lux)',
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
    
    // ì „ë ¥ ì°¨íŠ¸
    const powerCtx = document.getElementById('powerChart')?.getContext('2d');
    if (powerCtx) {
        powerChart = new Chart(powerCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'ì „ë ¥ (W)',
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
                        text: 'ì†Œë¹„ ì „ë ¥ (W)',
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

// ë°ì´í„° ì €ìž¥ì†Œì—ì„œ ì°¨íŠ¸ ì—…ë°ì´íŠ¸
function updateChartsFromStore() {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
    
    // ì„¼ì„œ ë°ì´í„° ì°¨íŠ¸ ì—…ë°ì´íŠ¸
    const devices = Object.keys(chartDataStore.temperature);
    
    // ì˜¨ë„ ì°¨íŠ¸
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
    
    // ìŠµë„ ì°¨íŠ¸
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
    
    // CO2 ì°¨íŠ¸
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
    
    // ì¡°ë„ ì°¨íŠ¸
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
    
    // ì „ë ¥ ì°¨íŠ¸
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

// ìžë™ ê¸‰ìˆ˜
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
        
        addLog(`ê¸‰ìˆ˜ ì„¤ì •: ëŒ€ê¸° ${delay}ì´ˆ, ê¸‰ìˆ˜ ${duration}ì´ˆ, ${cycles}íšŒ ë°˜ë³µ`, 'success');
    } catch (error) {
        addLog(`ê¸‰ìˆ˜ ì„¤ì • ì‹¤íŒ¨: ${error.message}`, 'error');
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
        
        addLog('ìžë™ ê¸‰ìˆ˜ ì‹œìž‘', 'success');
    } catch (error) {
        addLog(`ê¸‰ìˆ˜ ì‹œìž‘ ì‹¤íŒ¨: ${error.message}`, 'error');
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
        
        addLog('ìžë™ ê¸‰ìˆ˜ ì •ì§€', 'success');
    } catch (error) {
        addLog(`ê¸‰ìˆ˜ ì •ì§€ ì‹¤íŒ¨: ${error.message}`, 'error');
    }
}

function updateWaterStatus(running) {
    const statusElement = document.getElementById('water-status');
    if (running) {
        statusElement.textContent = 'ìž‘ë™ ì¤‘';
        statusElement.classList.add('running');
    } else {
        statusElement.textContent = 'ì •ì§€';
        statusElement.classList.remove('running');
    }
}

// âœ… ìˆ˜ì •ëœ ì´ˆê¸° ìƒíƒœ ë¡œë“œ
async function loadInitialStatus() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) throw new Error('Failed to get status');
        
        const data = await response.json();
        updateSystemStatus(data);
        
        // âœ… ì„œë²„ ìƒíƒœ ë¡œë“œ ì™„ë£Œ í”Œëž˜ê·¸ ì„¤ì •
        serverStateLoaded = true;
        
        // âœ… ëª¨ë“  ë¦´ë ˆì´ê°€ êº¼ì ¸ìžˆìœ¼ë©´ ì„œë²„ê°€ ìž¬ì‹œìž‘ëœ ê²ƒìœ¼ë¡œ íŒë‹¨
        const allRelaysOff = data.relays && data.relays.every(state => !state);
        
        if (allRelaysOff) {
            addLog('ì„œë²„ ìž¬ì‹œìž‘ ê°ì§€ - ì´ì „ ìƒíƒœ ë³µì› ì¤‘...', 'info');
            // ìž ì‹œ ëŒ€ê¸° í›„ ë³µì› (ì„œë²„ê°€ ì™„ì „ížˆ ì¤€ë¹„ë  ì‹œê°„ í™•ë³´)
            setTimeout(() => {
                restoreSavedState();
            }, 1000);
        } else {
            addLog('ì‹œìŠ¤í…œ ì´ˆê¸°í™” ì™„ë£Œ', 'info');
            // ì„œë²„ì— ì´ë¯¸ ìƒíƒœê°€ ìžˆìœ¼ë©´ ê·¸ê²ƒì„ ì €ìž¥
            saveState();
        }
    } catch (error) {
        addLog(`ì´ˆê¸°í™” ì‹¤íŒ¨: ${error.message}`, 'error');
        // ì´ˆê¸°í™” ì‹¤íŒ¨ ì‹œì—ë„ ë³µì› ì‹œë„
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
    
    // ì‹œìŠ¤í…œ ë¡œê·¸ì— ì €ìž¥ (ë©”ëª¨ë¦¬ì—ë§Œ)
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

// ========== ìŠ¤ì¼€ì¤„ ê´€ë¦¬ ==========

// ìŠ¤ì¼€ì¤„ ë¡œë“œ
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
        
        // âœ… ì €ìž¥ëœ ëª¨ë“œ ìƒíƒœ ë³µì›
        const savedMotorMode = localStorage.getItem(MOTOR_MODE_KEY);
        if (savedMotorMode !== null) {
            motorAutoMode = JSON.parse(savedMotorMode);
        }
        
        const savedLEDMode = localStorage.getItem(LED_MODE_KEY);
        if (savedLEDMode !== null) {
            ledAutoMode = JSON.parse(savedLEDMode);
        }
        
        // ëª¨ë“œ í‘œì‹œ ì´ˆê¸°í™”
        updateMotorModeDisplay();
        updateLEDModeDisplay();
        
        // 1ë¶„ë§ˆë‹¤ ìŠ¤ì¼€ì¤„ ì²´í¬
        if (scheduleCheckInterval) {
            clearInterval(scheduleCheckInterval);
        }
        scheduleCheckInterval = setInterval(checkSchedules, 60000);
        checkSchedules(); // ì¦‰ì‹œ í•œë²ˆ ì²´í¬
    } catch (error) {
        console.error('Failed to load schedules:', error);
    }
}

// ëª¨í„° ìŠ¤ì¼€ì¤„ ì¶”ê°€
function addMotorSchedule() {
    const startTime = document.getElementById('motor-start-time').value;
    const endTime = document.getElementById('motor-end-time').value;
    const speed = document.getElementById('motor-schedule-speed').value;
    const direction = document.getElementById('motor-schedule-direction').value;
    
    if (!startTime || !endTime) {
        alert('ì‹œìž‘ ì‹œê°„ê³¼ ì¢…ë£Œ ì‹œê°„ì„ ìž…ë ¥í•´ì£¼ì„¸ìš”.');
        return;
    }
    
    const days = [];
    document.querySelectorAll('.schedule-section:first-child .day-checkbox input:checked').forEach(checkbox => {
        days.push(parseInt(checkbox.value));
    });
    
    if (days.length === 0) {
        alert('ìµœì†Œ í•˜ë‚˜ì˜ ìš”ì¼ì„ ì„ íƒí•´ì£¼ì„¸ìš”.');
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
    
    addLog(`ëª¨í„° ìŠ¤ì¼€ì¤„ ì¶”ê°€: ${startTime} - ${endTime}`, 'success');
}

// LED ìŠ¤ì¼€ì¤„ ì¶”ê°€
function addLEDSchedule() {
    const onTime = document.getElementById('led-on-time').value;
    const offTime = document.getElementById('led-off-time').value;
    
    if (!onTime || !offTime) {
        alert('ì¼œê¸° ì‹œê°„ê³¼ ë„ê¸° ì‹œê°„ì„ ìž…ë ¥í•´ì£¼ì„¸ìš”.');
        return;
    }
    
    const leds = [];
    document.querySelectorAll('.led-selector input:checked').forEach(checkbox => {
        leds.push(parseInt(checkbox.value));
    });
    
    if (leds.length === 0) {
        alert('ìµœì†Œ í•˜ë‚˜ì˜ LEDë¥¼ ì„ íƒí•´ì£¼ì„¸ìš”.');
        return;
    }
    
    const days = [];
    document.querySelectorAll('.schedule-section:last-child .day-checkbox input:checked').forEach(checkbox => {
        days.push(parseInt(checkbox.value));
    });
    
    if (days.length === 0) {
        alert('ìµœì†Œ í•˜ë‚˜ì˜ ìš”ì¼ì„ ì„ íƒí•´ì£¼ì„¸ìš”.');
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
    
    addLog(`LED ìŠ¤ì¼€ì¤„ ì¶”ê°€: ${onTime} ON - ${offTime} OFF`, 'success');
}

// ëª¨í„° ìŠ¤ì¼€ì¤„ ëª©ë¡ ì—…ë°ì´íŠ¸
function updateMotorScheduleList() {
    const container = document.getElementById('motor-schedule-list');
    if (!container) return;
    
    if (motorSchedules.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">ë“±ë¡ëœ ìŠ¤ì¼€ì¤„ì´ ì—†ìŠµë‹ˆë‹¤.</p>';
        return;
    }
    
    const dayNames = ['ì›”', 'í™”', 'ìˆ˜', 'ëª©', 'ê¸ˆ', 'í† ', 'ì¼'];
    const directionNames = { 'forward': 'ì •íšŒì „', 'reverse': 'ì—­íšŒì „' };
    
    container.innerHTML = motorSchedules.map(schedule => `
        <div class="schedule-item ${schedule.enabled ? 'active' : ''}">
            <div class="schedule-info">
                <div class="schedule-time">${schedule.startTime} - ${schedule.endTime}</div>
                <div class="schedule-details">ì†ë„ ${schedule.speed} / ${directionNames[schedule.direction]}</div>
                <div class="schedule-days">
                    ${schedule.days.map(day => `<span class="schedule-day">${dayNames[day]}</span>`).join('')}
                </div>
            </div>
            <div class="schedule-actions">
                <button class="schedule-toggle ${schedule.enabled ? 'enabled' : ''}" 
                        onclick="toggleMotorSchedule(${schedule.id})">
                    ${schedule.enabled ? 'âœ“ í™œì„±' : 'âœ— ë¹„í™œì„±'}
                </button>
                <button class="schedule-delete" onclick="deleteMotorSchedule(${schedule.id})">
                    ðŸ—‘ï¸ ì‚­ì œ
                </button>
            </div>
        </div>
    `).join('');
}

// LED ìŠ¤ì¼€ì¤„ ëª©ë¡ ì—…ë°ì´íŠ¸
function updateLEDScheduleList() {
    const container = document.getElementById('led-schedule-list');
    if (!container) return;
    
    if (ledSchedules.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">ë“±ë¡ëœ ìŠ¤ì¼€ì¤„ì´ ì—†ìŠµë‹ˆë‹¤.</p>';
        return;
    }
    
    const dayNames = ['ì›”', 'í™”', 'ìˆ˜', 'ëª©', 'ê¸ˆ', 'í† ', 'ì¼'];
    
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
                    ${schedule.enabled ? 'âœ“ í™œì„±' : 'âœ— ë¹„í™œì„±'}
                </button>
                <button class="schedule-delete" onclick="deleteLEDSchedule(${schedule.id})">
                    ðŸ—‘ï¸ ì‚­ì œ
                </button>
            </div>
        </div>
    `).join('');
}

// ë‹¤ìŒ ìŠ¤ì¼€ì¤„ í”„ë¦¬ë·° ì—…ë°ì´íŠ¸
function updateMotorSchedulePreview() {
    const preview = document.getElementById('motor-next-schedule');
    if (!preview) return;
    
    const nextSchedule = getNextMotorSchedule();
    
    if (!nextSchedule || !motorAutoMode) {
        preview.textContent = motorAutoMode ? 'ì˜ˆì •ëœ ìŠ¤ì¼€ì¤„ ì—†ìŒ' : 'ìˆ˜ë™ ëª¨ë“œ (ìŠ¤ì¼€ì¤„ ë¹„í™œì„±)';
        return;
    }
    
    const directionNames = { 'forward': 'ì •íšŒì „', 'reverse': 'ì—­íšŒì „' };
    preview.textContent = `${nextSchedule.day} ${nextSchedule.startTime} - ì†ë„${nextSchedule.speed} ${directionNames[nextSchedule.direction]}`;
}

function updateLEDSchedulePreview() {
    const preview = document.getElementById('led-next-schedule');
    if (!preview) return;
    
    const nextSchedule = getNextLEDSchedule();
    
    if (!nextSchedule || !ledAutoMode) {
        preview.textContent = ledAutoMode ? 'ì˜ˆì •ëœ ìŠ¤ì¼€ì¤„ ì—†ìŒ' : 'ìˆ˜ë™ ëª¨ë“œ (ìŠ¤ì¼€ì¤„ ë¹„í™œì„±)';
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
    
    // ì˜¤ëŠ˜ ë‚¨ì€ ìŠ¤ì¼€ì¤„
    const todaySchedules = enabledSchedules.filter(s => {
        if (!s.days.includes(currentDay)) return false;
        const [hour, min] = s.startTime.split(':').map(Number);
        const scheduleTime = hour * 60 + min;
        return scheduleTime > currentTime;
    });
    
    if (todaySchedules.length > 0) {
        const sorted = todaySchedules.sort((a, b) => a.startTime.localeCompare(b.startTime));
        return { ...sorted[0], day: 'ì˜¤ëŠ˜' };
    }
    
    // ë‹¤ìŒ ìš”ì¼ ìŠ¤ì¼€ì¤„
    for (let i = 1; i <= 7; i++) {
        const checkDay = (currentDay + i) % 7;
        const daySchedules = enabledSchedules.filter(s => s.days.includes(checkDay));
        
        if (daySchedules.length > 0) {
            const sorted = daySchedules.sort((a, b) => a.startTime.localeCompare(b.startTime));
            const dayNames = ['ì›”', 'í™”', 'ìˆ˜', 'ëª©', 'ê¸ˆ', 'í† ', 'ì¼'];
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
    const dayNames = ['ì›”', 'í™”', 'ìˆ˜', 'ëª©', 'ê¸ˆ', 'í† ', 'ì¼'];
    
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
    
    // ì˜¤ëŠ˜ ë‚¨ì€ ì´ë²¤íŠ¸
    const todayEvents = allEvents.filter(e => e.day === currentDay && e.minutes > currentTime);
    if (todayEvents.length > 0) {
        const sorted = todayEvents.sort((a, b) => a.minutes - b.minutes);
        return { ...sorted[0], day: 'ì˜¤ëŠ˜' };
    }
    
    // ë‹¤ìŒ ìš”ì¼ ì´ë²¤íŠ¸
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

// ìŠ¤ì¼€ì¤„ í† ê¸€
function toggleMotorSchedule(id) {
    const schedule = motorSchedules.find(s => s.id === id);
    if (schedule) {
        schedule.enabled = !schedule.enabled;
        localStorage.setItem(MOTOR_SCHEDULE_KEY, JSON.stringify(motorSchedules));
        updateMotorScheduleList();
        updateMotorSchedulePreview();
        addLog(`ëª¨í„° ìŠ¤ì¼€ì¤„ ${schedule.enabled ? 'í™œì„±í™”' : 'ë¹„í™œì„±í™”'}`, 'info');
    }
}

function toggleLEDSchedule(id) {
    const schedule = ledSchedules.find(s => s.id === id);
    if (schedule) {
        schedule.enabled = !schedule.enabled;
        localStorage.setItem(LED_SCHEDULE_KEY, JSON.stringify(ledSchedules));
        updateLEDScheduleList();
        updateLEDSchedulePreview();
        addLog(`LED ìŠ¤ì¼€ì¤„ ${schedule.enabled ? 'í™œì„±í™”' : 'ë¹„í™œì„±í™”'}`, 'info');
    }
}

// ìŠ¤ì¼€ì¤„ ì‚­ì œ
function deleteMotorSchedule(id) {
    if (confirm('ì´ ìŠ¤ì¼€ì¤„ì„ ì‚­ì œí•˜ì‹œê² ìŠµë‹ˆê¹Œ?')) {
        motorSchedules = motorSchedules.filter(s => s.id !== id);
        localStorage.setItem(MOTOR_SCHEDULE_KEY, JSON.stringify(motorSchedules));
        updateMotorScheduleList();
        updateMotorSchedulePreview();
        addLog('ëª¨í„° ìŠ¤ì¼€ì¤„ ì‚­ì œë¨', 'info');
    }
}

function deleteLEDSchedule(id) {
    if (confirm('ì´ ìŠ¤ì¼€ì¤„ì„ ì‚­ì œí•˜ì‹œê² ìŠµë‹ˆê¹Œ?')) {
        ledSchedules = ledSchedules.filter(s => s.id !== id);
        localStorage.setItem(LED_SCHEDULE_KEY, JSON.stringify(ledSchedules));
        updateLEDScheduleList();
        updateLEDSchedulePreview();
        addLog('LED ìŠ¤ì¼€ì¤„ ì‚­ì œë¨', 'info');
    }
}

// ìžë™ ëª¨ë“œ ì„¤ì •
function setMotorAutoMode() {
    motorAutoMode = true;
    localStorage.setItem(MOTOR_MODE_KEY, JSON.stringify(motorAutoMode));
    updateMotorModeDisplay();
    updateMotorSchedulePreview();
    addLog('ëª¨í„° ìžë™ ëª¨ë“œë¡œ ì „í™˜', 'success');
}

function setLEDAutoMode() {
    ledAutoMode = true;
    localStorage.setItem(LED_MODE_KEY, JSON.stringify(ledAutoMode));
    updateLEDModeDisplay();
    updateLEDSchedulePreview();
    addLog('LED ìžë™ ëª¨ë“œë¡œ ì „í™˜', 'success');
}

// ëª¨ë“œ í‘œì‹œ ì—…ë°ì´íŠ¸
function updateMotorModeDisplay() {
    const badge = document.getElementById('motor-mode-badge');
    const btn = document.getElementById('motor-auto-btn');
    
    if (motorAutoMode) {
        badge.textContent = 'ðŸŸ¢ ìžë™ ëª¨ë“œ';
        badge.classList.remove('manual');
        badge.classList.add('auto');
        btn.style.display = 'none';
    } else {
        badge.textContent = 'ðŸ”´ ìˆ˜ë™ ëª¨ë“œ';
        badge.classList.remove('auto');
        badge.classList.add('manual');
        btn.style.display = 'inline-block';
    }
}

function updateLEDModeDisplay() {
    const badge = document.getElementById('led-mode-badge');
    const btn = document.getElementById('led-auto-btn');
    
    if (ledAutoMode) {
        badge.textContent = 'ðŸŸ¢ ìžë™ ëª¨ë“œ';
        badge.classList.remove('manual');
        badge.classList.add('auto');
        btn.style.display = 'none';
    } else {
        badge.textContent = 'ðŸ”´ ìˆ˜ë™ ëª¨ë“œ';
        badge.classList.remove('auto');
        badge.classList.add('manual');
        btn.style.display = 'inline-block';
    }
}

// ìŠ¤ì¼€ì¤„ ì²´í¬ ë° ì‹¤í–‰
function checkSchedules() {
    const now = new Date();
    const currentDay = (now.getDay() + 6) % 7;
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    // ëª¨í„° ìŠ¤ì¼€ì¤„ ì²´í¬
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
    
    // LED ìŠ¤ì¼€ì¤„ ì²´í¬
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
    
    // í”„ë¦¬ë·° ì—…ë°ì´íŠ¸
    updateMotorSchedulePreview();
    updateLEDSchedulePreview();
}

// ìŠ¤ì¼€ì¤„ ì‹¤í–‰
async function executeMotorSchedule(schedule) {
    addLog(`ìŠ¤ì¼€ì¤„ ì‹¤í–‰: ëª¨í„° ì†ë„${schedule.speed} ${schedule.direction === 'forward' ? 'ì •íšŒì „' : 'ì—­íšŒì „'}`, 'success');
    await setMotorSpeed(schedule.speed);
    await setMotorDirection(schedule.direction);
}

function stopMotorSchedule() {
    addLog('ìŠ¤ì¼€ì¤„ ì¢…ë£Œ: ëª¨í„° ì •ì§€', 'info');
    setMotorDirection('stop');
}

async function executeLEDSchedule(schedule, turnOn) {
    const action = turnOn ? 'ON' : 'OFF';
    addLog(`ìŠ¤ì¼€ì¤„ ì‹¤í–‰: LED ${schedule.leds.map(l => l - 9).join(', ')} ${action}`, 'success');
    
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

// ========== ì „ë ¥ ì‚¬ìš©ëŸ‰ ì°¨íŠ¸ ë° ë°ì´í„° ê´€ë¦¬ ==========

// ì „ë ¥ ì‚¬ìš©ëŸ‰ ì°¨íŠ¸ ì´ˆê¸°í™”
function initEnergyCharts() {
    // ì‹œê°„ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ ì°¨íŠ¸
    const energyHourlyCtx = document.getElementById('energyHourlyChart')?.getContext('2d');
    if (energyHourlyCtx) {
        energyHourlyChart = new Chart(energyHourlyCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'ì‹œê°„ë³„ ì‚¬ìš©ëŸ‰ (kWh)',
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
                        text: 'ì‹œê°„ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ (kWh)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'ì‚¬ìš©ëŸ‰: ' + context.parsed.y.toFixed(3) + ' kWh';
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
    
    // ì¼ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ ì°¨íŠ¸
    const energyDailyCtx = document.getElementById('energyDailyChart')?.getContext('2d');
    if (energyDailyCtx) {
        energyDailyChart = new Chart(energyDailyCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'ì¼ë³„ ì‚¬ìš©ëŸ‰ (kWh)',
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
                        text: 'ì¼ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ (kWh)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'ì‚¬ìš©ëŸ‰: ' + context.parsed.y.toFixed(2) + ' kWh';
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
    
    // ì›”ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ ì°¨íŠ¸
    const energyMonthlyCtx = document.getElementById('energyMonthlyChart')?.getContext('2d');
    if (energyMonthlyCtx) {
        energyMonthlyChart = new Chart(energyMonthlyCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'ì›”ë³„ ì‚¬ìš©ëŸ‰ (kWh)',
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
                        text: 'ì›”ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ (kWh)',
                        color: '#ecf0f1',
                        font: { size: 14 }
                    },
                    legend: {
                        labels: { color: '#ecf0f1' }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'ì‚¬ìš©ëŸ‰: ' + context.parsed.y.toFixed(1) + ' kWh';
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

// ì „ë ¥ ì°¨íŠ¸ ë°ì´í„° ë¡œë“œ
async function loadEnergyCharts() {
    try {
        // ì‹œê°„ë³„ ë°ì´í„° ë¡œë“œ (ì˜¤ëŠ˜)
        const today = new Date().toISOString().split('T')[0];
        const hourlyResponse = await fetch(`/api/db/energy/hourly?date=${today}`);
        if (hourlyResponse.ok) {
            const hourlyResult = await hourlyResponse.json();
            updateEnergyHourlyChart(hourlyResult.data);
        }
        
        // ì¼ë³„ ë°ì´í„° ë¡œë“œ (ìµœê·¼ 30ì¼)
        const dailyResponse = await fetch('/api/db/energy/daily?limit=30');
        if (dailyResponse.ok) {
            const dailyResult = await dailyResponse.json();
            updateEnergyDailyChart(dailyResult.data);
        }
        
        // ì›”ë³„ ë°ì´í„° ë¡œë“œ (ìµœê·¼ 12ê°œì›”)
        const monthlyResponse = await fetch('/api/db/energy/monthly?limit=12');
        if (monthlyResponse.ok) {
            const monthlyResult = await monthlyResponse.json();
            updateEnergyMonthlyChart(monthlyResult.data);
        }
        
        // ì‹¤ì‹œê°„ ì „ë ¥ ë°ì´í„° ë¡œë“œ
        const realtimeResponse = await fetch('/api/db/power_realtime?limit=50');
        if (realtimeResponse.ok) {
            const realtimeResult = await realtimeResponse.json();
            updatePowerRealtimeChart(realtimeResult.data);
        }
        
    } catch (error) {
        console.error('Failed to load energy charts:', error);
    }
}

// ì‹œê°„ë³„ ì°¨íŠ¸ ì—…ë°ì´íŠ¸
function updateEnergyHourlyChart(data) {
    if (!energyHourlyChart || !data || data.length === 0) return;
    
    // ì‹œê°„ ìˆœì„œëŒ€ë¡œ ì •ë ¬
    data.sort((a, b) => a.hour - b.hour);
    
    const labels = data.map(d => `${d.hour}ì‹œ`);
    const values = data.map(d => d.energy_kwh);
    
    energyHourlyChart.data.labels = labels;
    energyHourlyChart.data.datasets[0].data = values;
    energyHourlyChart.update('none');
}

// ì¼ë³„ ì°¨íŠ¸ ì—…ë°ì´íŠ¸
function updateEnergyDailyChart(data) {
    if (!energyDailyChart || !data || data.length === 0) return;
    
    // ì—­ìˆœ ì •ë ¬ (ë‚ ì§œ ìˆœì„œëŒ€ë¡œ)
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

// ì›”ë³„ ì°¨íŠ¸ ì—…ë°ì´íŠ¸
function updateEnergyMonthlyChart(data) {
    if (!energyMonthlyChart || !data || data.length === 0) return;
    
    // ì—­ìˆœ ì •ë ¬ (ë‚ ì§œ ìˆœì„œëŒ€ë¡œ)
    data.reverse();
    
    const labels = data.map(d => `${d.year}ë…„ ${d.month}ì›”`);
    const values = data.map(d => d.energy_kwh);
    
    energyMonthlyChart.data.labels = labels;
    energyMonthlyChart.data.datasets[0].data = values;
    energyMonthlyChart.update('none');
}

// ì‹¤ì‹œê°„ ì „ë ¥ ì°¨íŠ¸ ì—…ë°ì´íŠ¸
function updatePowerRealtimeChart(data) {
    if (!powerChart || !data || data.length === 0) return;
    
    // ì—­ìˆœ ì •ë ¬ (ì‹œê°„ ìˆœì„œëŒ€ë¡œ)
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

// ì „ë ¥ ìš”ê¸ˆ ê³„ì‚° (í•œêµ­ì „ë ¥ ëˆ„ì§„ì œ ê¸°ì¤€)
function calculateElectricityCost(kwh) {
    let cost = 0;
    if (kwh <= 200) {
        cost = kwh * 93.3;
    } else if (kwh <= 400) {
        cost = 200 * 93.3 + (kwh - 200) * 187.9;
    } else {
        cost = 200 * 93.3 + 200 * 187.9 + (kwh - 400) * 280.6;
    }
    
    // ê¸°ë³¸ìš”ê¸ˆ
    cost += 1000;
    
    // ë¶€ê°€ì„¸ 10%
    cost *= 1.1;
    
    return Math.round(cost);
}

// ì „ë ¥ ì‚¬ìš©ëŸ‰ ë°ì´í„° ë¡œë“œ
async function loadEnergyUsageData() {
    try {
        // ì‹œê°„ë³„ ë°ì´í„°
        const today = new Date().toISOString().split('T')[0];
        const hourlyResponse = await fetch(`/api/db/energy/hourly?date=${today}`);
        if (hourlyResponse.ok) {
            const hourlyResult = await hourlyResponse.json();
            updateEnergyHourlyTable(hourlyResult.data);
        }
        
        // ì¼ë³„ ë°ì´í„°
        const dailyResponse = await fetch('/api/db/energy/daily?limit=30');
        if (dailyResponse.ok) {
            const dailyResult = await dailyResponse.json();
            updateEnergyDailyTable(dailyResult.data);
        }
        
        // ì›”ë³„ ë°ì´í„°
        const monthlyResponse = await fetch('/api/db/energy/monthly?limit=12');
        if (monthlyResponse.ok) {
            const monthlyResult = await monthlyResponse.json();
            updateEnergyMonthlyTable(monthlyResult.data);
        }
        
        // í†µê³„ ì—…ë°ì´íŠ¸
        updateEnergyStats();
        
    } catch (error) {
        console.error('Failed to load energy usage data:', error);
    }
}

// ì‹œê°„ë³„ í…Œì´ë¸” ì—…ë°ì´íŠ¸
function updateEnergyHourlyTable(data) {
    const tbody = document.getElementById('energy-hourly-body');
    if (!tbody) return;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">ë°ì´í„° ì—†ìŒ</td></tr>';
        return;
    }
    
    // ì‹œê°„ ìˆœì„œëŒ€ë¡œ ì •ë ¬
    data.sort((a, b) => a.hour - b.hour);
    
    tbody.innerHTML = data.map(row => `
        <tr>
            <td>${row.hour}:00 ~ ${row.hour}:59</td>
            <td><strong>${row.energy_kwh.toFixed(3)}</strong></td>
            <td>${row.avg_power ? row.avg_power.toFixed(1) : '-'}</td>
        </tr>
    `).join('');
}

// ì¼ë³„ í…Œì´ë¸” ì—…ë°ì´íŠ¸
function updateEnergyDailyTable(data) {
    const tbody = document.getElementById('energy-daily-body');
    if (!tbody) return;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">ë°ì´í„° ì—†ìŒ</td></tr>';
        return;
    }
    
    // ë‚ ì§œ ì—­ìˆœ ì •ë ¬ (ìµœì‹ ë¶€í„°)
    data.sort((a, b) => b.date.localeCompare(a.date));
    
    tbody.innerHTML = data.map(row => {
        const cost = calculateElectricityCost(row.energy_kwh);
        return `
            <tr>
                <td>${row.date}</td>
                <td><strong>${row.energy_kwh.toFixed(3)}</strong></td>
                <td>${row.avg_power ? row.avg_power.toFixed(1) : '-'}</td>
                <td style="color: var(--color-warning);">${cost.toLocaleString()} ì›</td>
            </tr>
        `;
    }).join('');
}

// ì›”ë³„ í…Œì´ë¸” ì—…ë°ì´íŠ¸
function updateEnergyMonthlyTable(data) {
    const tbody = document.getElementById('energy-monthly-body');
    if (!tbody) return;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">ë°ì´í„° ì—†ìŒ</td></tr>';
        return;
    }
    
    // ë…„ì›” ì—­ìˆœ ì •ë ¬ (ìµœì‹ ë¶€í„°)
    data.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
    });
    
    tbody.innerHTML = data.map(row => {
        const cost = calculateElectricityCost(row.energy_kwh);
        return `
            <tr>
                <td>${row.year}ë…„ ${row.month}ì›”</td>
                <td><strong>${row.energy_kwh.toFixed(2)}</strong></td>
                <td>${row.avg_power ? row.avg_power.toFixed(1) : '-'}</td>
                <td style="color: var(--color-warning); font-weight: bold;">
                    ${cost.toLocaleString()} ì›
                </td>
            </tr>
        `;
    }).join('');
}

// í†µê³„ ì—…ë°ì´íŠ¸
async function updateEnergyStats() {
    try {
        // ì˜¤ëŠ˜ ì‚¬ìš©ëŸ‰
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
        
        // ì´ë²ˆ ë‹¬ ì‚¬ìš©ëŸ‰
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
            
            // ì˜ˆìƒ ì›” ìš”ê¸ˆ
            const monthlyCost = calculateElectricityCost(monthUsage);
            const statMonthlyCost = document.getElementById('stat-monthly-cost');
            if (statMonthlyCost) {
                statMonthlyCost.textContent = `${monthlyCost.toLocaleString()} ì›`;
            }
        }
        
        // í‰ê·  ì¼ì¼ ì‚¬ìš©ëŸ‰ (ìµœê·¼ 30ì¼)
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

// CSV ë‹¤ìš´ë¡œë“œ í•¨ìˆ˜ë“¤
async function downloadEnergyHourly() {
    try {
        const response = await fetch('/api/db/export/energy_hourly');
        if (!response.ok) throw new Error('ë‹¤ìš´ë¡œë“œ ì‹¤íŒ¨');
        
        const result = await response.json();
        downloadFile(result.csv, 'energy_hourly.csv', 'text/csv');
    } catch (error) {
        alert('ì‹œê°„ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ ë‹¤ìš´ë¡œë“œì— ì‹¤íŒ¨í–ˆìŠµë‹ˆë‹¤.');
        console.error(error);
    }
}

async function downloadEnergyDaily() {
    try {
        const response = await fetch('/api/db/export/energy_daily');
        if (!response.ok) throw new Error('ë‹¤ìš´ë¡œë“œ ì‹¤íŒ¨');
        
        const result = await response.json();
        downloadFile(result.csv, 'energy_daily.csv', 'text/csv');
    } catch (error) {
        alert('ì¼ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ ë‹¤ìš´ë¡œë“œì— ì‹¤íŒ¨í–ˆìŠµë‹ˆë‹¤.');
        console.error(error);
    }
}

async function downloadEnergyMonthly() {
    try {
        const response = await fetch('/api/db/export/energy_monthly');
        if (!response.ok) throw new Error('ë‹¤ìš´ë¡œë“œ ì‹¤íŒ¨');
        
        const result = await response.json();
        downloadFile(result.csv, 'energy_monthly.csv', 'text/csv');
    } catch (error) {
        alert('ì›”ë³„ ì „ë ¥ ì‚¬ìš©ëŸ‰ ë‹¤ìš´ë¡œë“œì— ì‹¤íŒ¨í–ˆìŠµë‹ˆë‹¤.');
        console.error(error);
    }
}

// ========== ë©”ì¸ íƒ­ ì „í™˜ í•¨ìˆ˜ ==========

/**
 * ë©”ì¸ íƒ­ ì „í™˜ (ëŒ€ì‹œë³´ë“œ / ë°ì´í„° ë¶„ì„ / ìŠ¤ì¼€ì¤„)
 */
function switchMainTab(tabName) {
    // ëª¨ë“  ë©”ì¸ íƒ­ ë²„íŠ¼ê³¼ ì»¨í…ì¸  ë¹„í™œì„±í™”
    document.querySelectorAll('.main-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.main-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // ì„ íƒëœ íƒ­ í™œì„±í™”
    event.target.classList.add('active');
    document.getElementById(tabName + '-main-tab').classList.add('active');
    
    // ì°¨íŠ¸ê°€ ìžˆëŠ” íƒ­ì´ë©´ ë¦¬ì‚¬ì´ì¦ˆ
    if (tabName === 'data-analysis') {
        setTimeout(() => {
            resizeAllCharts();
        }, 100);
    }
}

/**
 * ì„œë¸Œ íƒ­ ì „í™˜ (ë°ì´í„° ë¶„ì„ íƒ­ ë‚´ë¶€)
 */
function switchTab(tabName) {
    // ëª¨ë“  ì„œë¸Œ íƒ­ ë²„íŠ¼ê³¼ ì»¨í…ì¸  ë¹„í™œì„±í™”
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // ì„ íƒëœ ì„œë¸Œ íƒ­ í™œì„±í™”
    event.target.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');
    
    // ê·¸ëž˜í”„ íƒ­ì´ë©´ ì°¨íŠ¸ ë¦¬ì‚¬ì´ì¦ˆ
    if (tabName === 'charts') {
        setTimeout(() => {
            resizeAllCharts();
        }, 100);
    }
    
    // ì „ë ¥ ì‚¬ìš©ëŸ‰ íƒ­ì´ë©´ ë°ì´í„° ë¡œë“œ
    if (tabName === 'energy-usage') {
        loadEnergyUsageData();
    }
}

/**
 * ëª¨ë“  ì°¨íŠ¸ ë¦¬ì‚¬ì´ì¦ˆ
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

// ì´ íŒŒì¼ì„ ê¸°ì¡´ app.jsì— ì¶”ê°€í•˜ê±°ë‚˜, 
// HTMLì—ì„œ <script src="/static/js/app_tab_functions.js"></script>ë¡œ ë³„ë„ ë¡œë“œ