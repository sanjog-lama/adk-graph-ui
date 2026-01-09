// ============================================
// Constants and Configuration
// ============================================

const AppState = {
    currentAgent: '',
    currentUserId: `user_1767786285796`,
    currentSessionId: null,
    sessions: {},

    // Configurations
    markedConfig: {
        breaks: true,
        gfm: true
    }
};

// ============================================
// Core Utilities
// ============================================

const Utils = {
    formatMessageContent(content) {
        return marked.parse(content);
    },

    html(strings, ...values) {
        return strings.reduce((result, str, i) => {
            const value = values[i] || '';
            return result + str + this.escapeHtml(value);
        }, '');
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    createElementFromHTML(htmlString) {
        const template = document.createElement('template');
        template.innerHTML = htmlString.trim();
        return template.content.firstChild;
    },

    showNotification(message, type = 'info') {
        if (type === 'error') {
            console.error('[Notification]', message);
            alert(`Error: ${message}`);
        } else {
            console.log('[Notification]', message);
        }
    },

    log(context, ...args) {
        console.log(`[${context}]`, ...args);
    },

    error(context, ...args) {
        console.error(`[${context}]`, ...args);
    }
};

// ============================================
// API Service Layer
// ============================================

const ApiService = {
    async fetchWithError(url, options = {}) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            Utils.error('API', error.message);
            throw error;
        }
    },

    async listAgents() {
        return await this.fetchWithError('/api/list-agents');
    },

    async loadSessions(agent, userId) {
        return await this.fetchWithError(`/api/sessions?agent=${agent}&user=${userId}`);
    },

    async createSession(agent, userId, sessionId) {
        return await this.fetchWithError('/api/create-session', {
            method: 'POST',
            body: JSON.stringify({ agent, userId, sessionId })
        });
    },

    async deleteSession(agent, userId, sessionId) {
        return await this.fetchWithError('/api/delete-session', {
            method: 'DELETE',
            body: JSON.stringify({ agent, userId, sessionId })
        });
    },

    async sendMessage(agent, userId, sessionId, message) {
        return await this.fetchWithError('/api/send-message', {
            method: 'POST',
            body: JSON.stringify({ agent, userId, sessionId, message })
        });
    }
};

// ============================================
// Analytics Parser
// ============================================

const AnalyticsParser = {
    extractAnalyticsData(fullResponse) {
        // Case 1: Try extracting from full_response array structure
        if (fullResponse && Array.isArray(fullResponse)) {
            for (const event of fullResponse) {
                const possiblePaths = [
                    event?.actions?.stateDelta?.analytics_output,
                    event?.stateDelta?.analytics_output,
                    event?.analytics_output
                ];

                for (const data of possiblePaths) {
                    if (data !== undefined && data !== null) {
                        Utils.log('AnalyticsParser', 'Found analytics_output in full_response:', data);
                        return this.parseAnalyticsData(data);
                    }
                }
            }
        }
        
        // Case 2: Try extracting from message content string
        if (typeof fullResponse === 'string') {
            Utils.log('AnalyticsParser', 'Attempting to extract from content string');
            return this.extractFromContentString(fullResponse);
        }

        Utils.log('AnalyticsParser', 'No analytics_output found');
        return null;
    },

    extractFromContentString(content) {
        // 1️⃣ Try fenced ```json blocks first (existing behavior)
        const codeBlockRegex = /```json\s*([\s\S]*?)\s*```/g;
        const matches = [...content.matchAll(codeBlockRegex)];

        for (const match of matches) {
            try {
                const parsed = JSON.parse(match[1].trim());
                if (this.isAnalyticsData(parsed)) {
                    Utils.log('AnalyticsParser', 'Extracted analytics from fenced JSON');
                    return parsed;
                }
            } catch (e) {}
        }

        // 2️⃣ Fallback: extract LAST JSON object in text
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}$/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (this.isAnalyticsData(parsed)) {
                    Utils.log('AnalyticsParser', 'Extracted analytics from raw JSON');
                    return parsed;
                }
            }
        } catch (err) {
            Utils.error('AnalyticsParser', 'Raw JSON parse failed', err);
        }

        return null;
    },

    isAnalyticsData(data) {
        // Check if the parsed JSON has analytics-specific fields
        return data && typeof data === 'object' && (
            data.hasOwnProperty('visualization_hints') ||
            data.hasOwnProperty('analysis_summary') ||
            data.hasOwnProperty('insights') ||
            data.hasOwnProperty('recommendations')
        );
    },

    parseAnalyticsData(analyticsData) {
        let jsonData = null;

        if (typeof analyticsData === 'object' && analyticsData !== null) {
            jsonData = analyticsData;
            Utils.log('AnalyticsParser', 'Analytics data is already an object');
        } else if (typeof analyticsData === 'string') {
            const codeBlockRegex = /```json([\s\S]*?)```/;
            const match = analyticsData.match(codeBlockRegex);
            let jsonString = match?.[1] || analyticsData;

            try {
                jsonData = JSON.parse(jsonString.trim());
                Utils.log('AnalyticsParser', 'Successfully parsed analytics data as JSON');
            } catch (err) {
                Utils.error('AnalyticsParser', 'Failed to parse JSON:', err);
                try {
                    const fixedJson = jsonString.replace(/,(\s*[}\]])/g, '$1').trim();
                    jsonData = JSON.parse(fixedJson);
                    Utils.log('AnalyticsParser', 'Successfully parsed JSON after fixing common issues');
                } catch (err2) {
                    Utils.error('AnalyticsParser', 'Still failed after fixing:', err2);
                    jsonData = null;
                }
            }
        } else {
            Utils.error('AnalyticsParser', 'analyticsData is neither object nor string', analyticsData);
        }

        return jsonData;
    }
};


// ============================================
// Chart Renderer
// ============================================

const ChartRenderer = {
    renderAnalysisChart(jsonData, container) {
        Utils.log('ChartRenderer', '==== RENDERING CHARTS WITH DATA ====');
        Utils.log('ChartRenderer', 'Full JSON Data:', jsonData);

        if (jsonData.analysis_summary) {
            this.renderTextBlock('Analysis Summary', jsonData.analysis_summary, container);
        }

        if (jsonData.insights?.length > 0) {
            this.renderListBlock('Key Insights', jsonData.insights, container);
        }

        if (jsonData.visualization_hints?.length > 0) {
            this.renderCharts(jsonData.visualization_hints, container);
        }

        if (jsonData.recommendations?.length > 0) {
            this.renderListBlock('Recommendations', jsonData.recommendations, container);
        }

        container.scrollTop = container.scrollHeight;
    },

    renderTextBlock(title, content, container) {
        const blockDiv = document.createElement('div');
        blockDiv.className = 'message assistant';
        blockDiv.innerHTML = `
            <div class="message-content">
                <strong>${Utils.escapeHtml(title)}:</strong><br>
                ${Utils.formatMessageContent(content)}
            </div>
        `;
        container.appendChild(blockDiv);
    },

    renderListBlock(title, items, container) {
        const listDiv = document.createElement('div');
        listDiv.className = 'message assistant';
        const listHtml = items.map(item => `• ${Utils.escapeHtml(item)}`).join('<br>');
        listDiv.innerHTML = `
            <div class="message-content">
                <strong>${Utils.escapeHtml(title)}:</strong><br>
                ${listHtml}
            </div>
        `;
        container.appendChild(listDiv);
    },

    renderCharts(visualizationHints, container) {
        const baseId = Date.now();
        visualizationHints.forEach((chart, idx) => {
            Utils.log(`ChartRenderer[${idx}]`, 'Creating chart:', chart);
            const chartDiv = document.createElement('div');
            chartDiv.className = 'chart-container';
            const chartId = `chart-${baseId}-${idx}`;
            chartDiv.innerHTML = `<div id="${chartId}" style="width:100%;height:400px;"></div>`;
            container.appendChild(chartDiv);

            setTimeout(() => this.renderSingleChart(chart, chartId), 50);
        });
    },

    renderSingleChart(chart, chartId) {
        const chartContainer = document.getElementById(chartId);
        if (!chartContainer) {
            Utils.error('ChartRenderer', `Chart container ${chartId} not found`);
            return;
        }

        const plotData = this.createPlotData(chart);
        const layout = this.createChartLayout(chart.title);
        Plotly.newPlot(chartContainer, plotData, layout);
    },

    createPlotData(chart) {
        const baseConfig = { marker: { color: '#667eea' } };
        switch (chart.chart_type) {
            case 'bar':
                return [{ ...baseConfig, x: chart.x, y: chart.y, type: 'bar' }];
            case 'pie':
                return [{
                    labels: chart.x,
                    values: chart.y,
                    type: 'pie',
                    marker: { colors: ['#667eea', '#764ba2', '#f093fb', '#4facfe'] }
                }];
            case 'line':
                return [{ ...baseConfig, x: chart.x, y: chart.y, type: 'scatter', mode: 'lines+markers' }];
            default:
                Utils.error('ChartRenderer', `Unknown chart type: ${chart.chart_type}`);
                return [];
        }
    },

    createChartLayout(title) {
        return {
            title: title,
            font: { family: 'Arial, sans-serif' },
            margin: { t: 50, b: 50, l: 50, r: 50 },
            paper_bgcolor: 'white',
            plot_bgcolor: 'white'
        };
    }
};

// ============================================
// UI Renderers
// ============================================

const UIRenderer = {
    renderSessions(sessions, currentSessionId, onSessionClick) {
        const container = document.getElementById('sessionsContainer');
        const sessionIds = Object.keys(sessions);

        if (sessionIds.length === 0) {
            container.innerHTML = `<div class="empty-state" style="padding: 20px; text-align: center;">
                <p>No sessions yet</p>
            </div>`;
            return;
        }

        container.innerHTML = sessionIds.map(sessionId => {
            const session = sessions[sessionId];
            const isActive = sessionId === currentSessionId;
            return `
                <div class="session-item ${isActive ? 'active' : ''}" 
                     data-session-id="${Utils.escapeHtml(sessionId)}">
                    <div class="session-name">Session ${Utils.escapeHtml(sessionId.substring(0, 8))}</div>
                    <div class="session-time">${new Date(session.created).toLocaleString()}</div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', () => {
                const sessionId = item.dataset.sessionId;
                onSessionClick(sessionId);
            });
        });
    },

    renderMessages(messages) {
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';

        if (!messages || messages.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">👋</div>
                    <h2>Start chatting!</h2>
                    <p>Send your first message below</p>
                </div>
            `;
            return;
        }

        messages.forEach((msg, idx) => {
            Utils.log('UIRenderer', `Processing message ${idx}:`, msg);

            if (msg.role === 'assistant') {
                // Try extracting analytics data first
                let jsonData = null;
                
                if (msg.full_response) {
                    jsonData = AnalyticsParser.extractAnalyticsData(msg.full_response);
                }
                
                // If no data found in full_response, try extracting from content
                if (!jsonData && msg.content) {
                    jsonData = AnalyticsParser.extractFromContentString(msg.content);
                }

                if (jsonData) {
                    // This is analytics output - render charts only, skip text content
                    Utils.log('UIRenderer', 'Rendering charts for message', idx);
                    ChartRenderer.renderAnalysisChart(jsonData, container);
                } else {
                    // Regular message - render normally
                    const msgDiv = document.createElement('div');
                    msgDiv.className = `message ${msg.role}`;
                    msgDiv.innerHTML = `
                        <div class="message-content">${Utils.formatMessageContent(msg.content)}</div>
                        <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
                    `;
                    container.appendChild(msgDiv);
                }
            } else {
                // User messages always render normally
                const msgDiv = document.createElement('div');
                msgDiv.className = `message ${msg.role}`;
                msgDiv.innerHTML = `
                    <div class="message-content">${Utils.formatMessageContent(msg.content)}</div>
                    <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
                `;
                container.appendChild(msgDiv);
            }
        });

        container.scrollTop = container.scrollHeight;
    },

    renderMessage(msg, container) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.role}`;
        messageDiv.innerHTML = `
            <div class="message-content">${Utils.formatMessageContent(msg.content)}</div>
            <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
        `;
        container.appendChild(messageDiv);
    },

    updateUIState(isSessionSelected) {
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const deleteBtn = document.getElementById('deleteSessionBtn');
        const chatTitle = document.getElementById('chatTitle');

        if (isSessionSelected) {
            messageInput.disabled = false;
            sendBtn.disabled = false;
            deleteBtn.style.display = 'block';
            chatTitle.textContent = `${AppState.currentAgent} - Session ${AppState.currentSessionId.substring(0, 8)}`;
        } else {
            messageInput.disabled = true;
            sendBtn.disabled = true;
            deleteBtn.style.display = 'none';
            chatTitle.textContent = AppState.currentAgent 
                ? `${AppState.currentAgent} - Select or create a session` 
                : 'Welcome to ADK Chat';
        }
    }
};

// ============================================
// Main Application Controller
// ============================================

const AppController = {
    async init() {
        marked.setOptions(AppState.markedConfig);
        await this.loadAgents();
        this.setupEventListeners();
    },

    async loadAgents() {
        try {
            const agents = await ApiService.listAgents();
            const selector = document.getElementById('agentSelector');
            selector.innerHTML = '<option value="">Select Agent...</option>';
            agents.forEach(agent => {
                const option = document.createElement('option');
                option.value = agent;
                option.textContent = agent;
                selector.appendChild(option);
            });
        } catch {
            Utils.showNotification('Failed to load agents', 'error');
        }
    },

    async loadSessions() {
        if (!AppState.currentAgent) return;
        try {
            AppState.sessions = await ApiService.loadSessions(AppState.currentAgent, AppState.currentUserId);
            UIRenderer.renderSessions(AppState.sessions, AppState.currentSessionId, this.selectSession.bind(this));
        } catch {
            Utils.showNotification('Failed to load sessions', 'error');
        }
    },

    async selectSession(sessionId) {
        AppState.currentSessionId = sessionId;
        UIRenderer.renderSessions(AppState.sessions, AppState.currentSessionId, this.selectSession.bind(this));
        UIRenderer.updateUIState(true);

        try {
            const sessionData = await ApiService.fetchWithError(
                `/api/session/${sessionId}?agent=${AppState.currentAgent}&user=${AppState.currentUserId}`
            );

            AppState.sessions[sessionId] = {
                ...AppState.sessions[sessionId],
                messages: sessionData.messages || []
            };

            UIRenderer.renderMessages(AppState.sessions[sessionId].messages);
        } catch {
            Utils.showNotification('Failed to load session messages', 'error');
        }
    },

    async createNewSession() {
        if (!AppState.currentAgent) {
            Utils.showNotification('Please select an agent first', 'error');
            return;
        }

        const sessionId = `s_${Date.now()}`;
        try {
            await ApiService.createSession(AppState.currentAgent, AppState.currentUserId, sessionId);
            AppState.sessions[sessionId] = { created: new Date().toISOString(), messages: [] };
            await this.selectSession(sessionId);
        } catch {
            Utils.showNotification('Failed to create session', 'error');
        }
    },

    async deleteCurrentSession() {
        if (!AppState.currentSessionId) return;
        if (!confirm('Delete this session?')) return;

        try {
            await ApiService.deleteSession(AppState.currentAgent, AppState.currentUserId, AppState.currentSessionId);
            delete AppState.sessions[AppState.currentSessionId];
            AppState.currentSessionId = null;

            UIRenderer.renderSessions(AppState.sessions, AppState.currentSessionId, this.selectSession.bind(this));
            UIRenderer.updateUIState(false);

            document.getElementById('messagesContainer').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">💬</div>
                    <h2>Start a conversation</h2>
                    <p>Select an agent and create a new session to begin</p>
                </div>
            `;
        } catch {
            Utils.showNotification('Failed to delete session', 'error');
        }
    },

    async sendMessage(message) {
        if (!message || !AppState.currentSessionId) return;

        const input = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');

        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="loading"></span>';
        input.disabled = true;

        try {
            AppState.sessions[AppState.currentSessionId].messages.push({
                role: 'user',
                content: message,
                timestamp: new Date().toISOString()
            });

            UIRenderer.renderMessages(AppState.sessions[AppState.currentSessionId].messages);
            input.value = '';

            const response = await ApiService.sendMessage(
                AppState.currentAgent,
                AppState.currentUserId,
                AppState.currentSessionId,
                message
            );

            if (response.status === 'success' && response.response) {
                AppState.sessions[AppState.currentSessionId].messages.push({
                    role: 'assistant',
                    content: response.response,
                    full_response: response.full_response,
                    timestamp: new Date().toISOString()
                });
                UIRenderer.renderMessages(AppState.sessions[AppState.currentSessionId].messages);
            } else {
                Utils.showNotification('Failed to get response from agent', 'error');
            }
        } catch {
            Utils.showNotification('Failed to send message', 'error');
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
            input.disabled = false;
            input.focus();
        }
    },

    setupEventListeners() {
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const message = document.getElementById('messageInput').value.trim();
            await this.sendMessage(message);
        });

        document.getElementById('newSessionBtn').addEventListener('click', () => this.createNewSession());
        document.getElementById('deleteSessionBtn').addEventListener('click', () => this.deleteCurrentSession());

        document.getElementById('agentSelector').addEventListener('change', async (e) => {
            AppState.currentAgent = e.target.value;
            AppState.currentSessionId = null;
            AppState.sessions = {};

            if (AppState.currentAgent) {
                await this.loadSessions();
            } else {
                UIRenderer.renderSessions(AppState.sessions, AppState.currentSessionId, this.selectSession.bind(this));
            }

            UIRenderer.updateUIState(false);
        });
    }
};

// ============================================
// Initialize Application
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    AppController.init().catch(error => {
        console.error('Failed to initialize application:', error);
    });
});
