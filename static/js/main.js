    // ============================================
// Constants and Configuration
// ============================================

const AppState = {
    currentAgent: '',
    currentUserId: `user_${Date.now()}`,
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
    /**
     * Format message content with markdown
     */
    formatMessageContent(content) {
        return marked.parse(content);
    },

    /**
     * Safe HTML template literal function
     */
    html(strings, ...values) {
        return strings.reduce((result, str, i) => {
            const value = values[i] || '';
            return result + str + this.escapeHtml(value);
        }, '');
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Create DOM element from HTML string
     */
    createElementFromHTML(htmlString) {
        const template = document.createElement('template');
        template.innerHTML = htmlString.trim();
        return template.content.firstChild;
    },

    /**
     * Show notification/alert
     */
    showNotification(message, type = 'info') {
        // Implement toast notification or use alert
        if (type === 'error') {
            console.error('[Notification]', message);
            alert(`Error: ${message}`);
        } else {
            console.log('[Notification]', message);
        }
    },

    /**
     * Log with timestamp
     */
    log(context, ...args) {
        console.log(`[${context}]`, ...args);
    },

    /**
     * Error log with timestamp
     */
    error(context, ...args) {
        console.error(`[${context}]`, ...args);
    }
};

// ============================================
// API Service Layer
// ============================================

const ApiService = {
    /**
     * Fetch with error handling
     */
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

    /**
     * List available agents
     */
    async listAgents() {
        return await this.fetchWithError('/api/list-agents');
    },

    /**
     * Load sessions for current agent
     */
    async loadSessions(agent, userId) {
        return await this.fetchWithError(`/api/sessions?agent=${agent}&user=${userId}`);
    },

    /**
     * Create new session
     */
    async createSession(agent, userId, sessionId) {
        return await this.fetchWithError('/api/create-session', {
            method: 'POST',
            body: JSON.stringify({ agent, userId, sessionId })
        });
    },

    /**
     * Delete session
     */
    async deleteSession(agent, userId, sessionId) {
        return await this.fetchWithError('/api/delete-session', {
            method: 'DELETE',
            body: JSON.stringify({ agent, userId, sessionId })
        });
    },

    /**
     * Send message to agent
     */
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
    /**
     * Extract analytics data from full_response
     */
    extractAnalyticsData(fullResponse) {
        if (!fullResponse || !Array.isArray(fullResponse)) {
            Utils.log('AnalyticsParser', 'No full_response or not an array');
            return null;
        }

        let analyticsData = null;

        for (let i = 0; i < fullResponse.length; i++) {
            const event = fullResponse[i];

            // Try multiple possible paths
            const possiblePaths = [
                event?.actions?.stateDelta?.analytics_output,
                event?.stateDelta?.analytics_output,
                event?.analytics_output
            ];

            for (const data of possiblePaths) {
                if (data !== undefined && data !== null) {
                    analyticsData = data;
                    Utils.log('AnalyticsParser', `Found analytics_output in event ${i}:`, analyticsData);
                    break;
                }
            }

            if (analyticsData) break;
        }

        if (analyticsData) {
            return this.parseAnalyticsData(analyticsData);
        } else {
            Utils.log('AnalyticsParser', 'No analytics data found in this message');
            return null;
        }
    },

    /**
     * Parse analytics data safely (handles strings, objects, and JSON code blocks)
     */
    parseAnalyticsData(analyticsData) {
        let jsonData = null;

        if (typeof analyticsData === 'object' && analyticsData !== null) {
            // Already an object
            jsonData = analyticsData;
            Utils.log('AnalyticsParser', 'Analytics data is already an object');
        } else if (typeof analyticsData === 'string') {
            // Try extracting JSON from markdown code block
            const codeBlockRegex = /```json([\s\S]*?)```/;
            const match = analyticsData.match(codeBlockRegex);

            let jsonString = match?.[1] || analyticsData;

            try {
                jsonData = JSON.parse(jsonString.trim());
                Utils.log('AnalyticsParser', 'Successfully parsed analytics data as JSON');
            } catch (err) {
                Utils.error('AnalyticsParser', 'Failed to parse JSON:', err);

                // Attempt to fix common issues (trailing commas, extra spaces)
                try {
                    const fixedJson = jsonString
                        .replace(/,(\s*[}\]])/g, '$1') // remove trailing commas
                        .trim();
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
    /**
     * Render analysis charts from JSON data
     */
    renderAnalysisChart(jsonData, container) {
        Utils.log('ChartRenderer', '==== RENDERING CHARTS WITH DATA ====');
        Utils.log('ChartRenderer', 'Full JSON Data:', jsonData);

        // Render analysis summary
        if (jsonData.analysis_summary) {
            this.renderTextBlock('Analysis Summary', jsonData.analysis_summary, container);
        }

        // Render insights
        if (jsonData.insights?.length > 0) {
            this.renderListBlock('Key Insights', jsonData.insights, container);
        }

        // Render charts
        if (jsonData.visualization_hints?.length > 0) {
            this.renderCharts(jsonData.visualization_hints, container);
        }

        // Render recommendations
        if (jsonData.recommendations?.length > 0) {
            this.renderListBlock('Recommendations', jsonData.recommendations, container);
        }

        container.scrollTop = container.scrollHeight;
    },

    /**
     * Render text block with markdown
     */
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

    /**
     * Render list block
     */
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

    /**
     * Render charts from visualization hints
     */
    renderCharts(visualizationHints, container) {
        Utils.log('ChartRenderer', `Rendering ${visualizationHints.length} charts`);

        visualizationHints.forEach((chart, idx) => {
            Utils.log(`ChartRenderer[${idx}]`, 'Creating chart:', {
                type: chart.chart_type,
                title: chart.title,
                x_length: chart.x?.length,
                y_length: chart.y?.length
            });

            // Create chart container
            const chartDiv = document.createElement('div');
            chartDiv.className = 'chart-container';
            const chartId = `chart-${Date.now()}-${idx}`;
            chartDiv.innerHTML = `<div id="${chartId}" style="width:100%;height:400px;"></div>`;
            container.appendChild(chartDiv);

            // Render chart with slight delay for DOM update
            setTimeout(() => this.renderSingleChart(chart, chartId), 100);
        });
    },

    /**
     * Render single chart
     */
    renderSingleChart(chart, chartId) {
        const chartContainer = document.getElementById(chartId);
        if (!chartContainer) {
            Utils.error('ChartRenderer', `Chart container ${chartId} not found`);
            return;
        }

        const plotData = this.createPlotData(chart);
        const layout = this.createChartLayout(chart.title);

        Utils.log('ChartRenderer', `Plotting chart with data:`, plotData);
        Plotly.newPlot(chartContainer, plotData, layout);
    },

    /**
     * Create Plotly plot data based on chart type
     */
    createPlotData(chart) {
        const baseConfig = {
            marker: { color: '#667eea' }
        };

        switch (chart.chart_type) {
            case 'bar':
                return [{
                    ...baseConfig,
                    x: chart.x,
                    y: chart.y,
                    type: 'bar'
                }];

            case 'pie':
                return [{
                    labels: chart.x,
                    values: chart.y,
                    type: 'pie',
                    marker: {
                        colors: ['#667eea', '#764ba2', '#f093fb', '#4facfe']
                    }
                }];

            case 'line':
                return [{
                    ...baseConfig,
                    x: chart.x,
                    y: chart.y,
                    type: 'scatter',
                    mode: 'lines+markers'
                }];

            default:
                Utils.error('ChartRenderer', `Unknown chart type: ${chart.chart_type}`);
                return [];
        }
    },

    /**
     * Create Plotly chart layout
     */
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
    /**
     * Render sessions in sidebar
     */
    renderSessions(sessions, currentSessionId, onSessionClick) {
        const container = document.getElementById('sessionsContainer');
        const sessionIds = Object.keys(sessions);

        if (sessionIds.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 20px; text-align: center;">
                    <p>No sessions yet</p>
                </div>
            `;
            return;
        }

        container.innerHTML = sessionIds.map(sessionId => {
            const session = sessions[sessionId];
            const isActive = sessionId === currentSessionId;
            
            return `
                <div class="session-item ${isActive ? 'active' : ''}" 
                     data-session-id="${Utils.escapeHtml(sessionId)}">
                    <div class="session-name">
                        Session ${Utils.escapeHtml(sessionId.substring(0, 8))}
                    </div>
                    <div class="session-time">
                        ${new Date(session.created).toLocaleString()}
                    </div>
                </div>
            `;
        }).join('');

        // Add click event listeners
        container.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', () => {
                const sessionId = item.dataset.sessionId;
                onSessionClick(sessionId);
            });
        });
    },

    /**
     * Render messages in chat area
     */
     renderMessages(messages) {
        const container = document.getElementById('messagesContainer');

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

        container.innerHTML = ''; // Clear container

        messages.forEach((msg, idx) => {
            Utils.log('UIRenderer', `Processing message ${idx}:`, {
                role: msg.role,
                hasFullResponse: !!msg.full_response,
                timestamp: msg.timestamp
            });

            // Render user/assistant plain text
            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${msg.role}`;
            msgDiv.innerHTML = `
                <div class="message-content">
                    ${Utils.formatMessageContent(msg.content)}
                </div>
                <div class="message-time">
                    ${new Date(msg.timestamp).toLocaleTimeString()}
                </div>
            `;
            container.appendChild(msgDiv);

            // If this is assistant and has analytics output, render charts
            if (msg.role === 'assistant' && msg.full_response) {
                const jsonData = AnalyticsParser.extractAnalyticsData(msg.full_response);
                
                if (jsonData) {
                    Utils.log('UIRenderer', '==== JSON DATA FOR CHART RENDERING ====');
                    Utils.log('UIRenderer', JSON.stringify(jsonData, null, 2));
                    Utils.log('UIRenderer', '==== END JSON DATA ====');
                    
                    ChartRenderer.renderAnalysisChart(jsonData, container);
                } else {
                    // Do NOT show chart error if jsonData is null because analytics_output is just missing
                    Utils.log('UIRenderer', 'No analytics_output found; skipping chart rendering.');
                }
            }
        });

        container.scrollTop = container.scrollHeight;
    },

    /**
     * Render single message
     */
    renderMessage(msg, container) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.role}`;
        messageDiv.innerHTML = `
            <div class="message-content">
                ${Utils.formatMessageContent(msg.content)}
            </div>
            <div class="message-time">
                ${new Date(msg.timestamp).toLocaleTimeString()}
            </div>
        `;
        container.appendChild(messageDiv);
    },

    /**
     * Update chat UI state
     */
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
    /**
     * Initialize the application
     */
    async init() {
        // Configure marked
        marked.setOptions(AppState.markedConfig);

        // Load agents
        await this.loadAgents();

        // Set up event listeners
        this.setupEventListeners();
    },

    /**
     * Load agents and populate selector
     */
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
        } catch (error) {
            Utils.showNotification('Failed to load agents', 'error');
        }
    },

    /**
     * Load sessions for current agent
     */
    async loadSessions() {
        if (!AppState.currentAgent) return;

        try {
            AppState.sessions = await ApiService.loadSessions(
                AppState.currentAgent, 
                AppState.currentUserId
            );
            UIRenderer.renderSessions(
                AppState.sessions, 
                AppState.currentSessionId,
                this.selectSession.bind(this)
            );
        } catch (error) {
            Utils.showNotification('Failed to load sessions', 'error');
        }
    },

    /**
     * Select a session
     */
    async selectSession(sessionId) {
        AppState.currentSessionId = sessionId;
        
        // Update UI
        UIRenderer.renderSessions(
            AppState.sessions,
            AppState.currentSessionId,
            this.selectSession.bind(this)
        );
        UIRenderer.updateUIState(true);
        
        // Load messages
        if (AppState.sessions[sessionId]?.messages) {
            UIRenderer.renderMessages(AppState.sessions[sessionId].messages);
        }
    },

    /**
     * Create new session
     */
    async createNewSession() {
        if (!AppState.currentAgent) {
            Utils.showNotification('Please select an agent first', 'error');
            return;
        }

        const sessionId = `s_${Date.now()}`;

        try {
            await ApiService.createSession(
                AppState.currentAgent,
                AppState.currentUserId,
                sessionId
            );

            // Update local state
            AppState.sessions[sessionId] = {
                created: new Date().toISOString(),
                messages: []
            };

            // Select the new session
            await this.selectSession(sessionId);
        } catch (error) {
            Utils.showNotification('Failed to create session', 'error');
        }
    },

    /**
     * Delete current session
     */
    async deleteCurrentSession() {
        if (!AppState.currentSessionId) return;

        if (!confirm('Delete this session?')) return;

        try {
            await ApiService.deleteSession(
                AppState.currentAgent,
                AppState.currentUserId,
                AppState.currentSessionId
            );

            // Update local state
            delete AppState.sessions[AppState.currentSessionId];
            AppState.currentSessionId = null;

            // Update UI
            UIRenderer.renderSessions(
                AppState.sessions,
                AppState.currentSessionId,
                this.selectSession.bind(this)
            );
            UIRenderer.updateUIState(false);
            
            document.getElementById('messagesContainer').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">💬</div>
                    <h2>Start a conversation</h2>
                    <p>Select an agent and create a new session to begin</p>
                </div>
            `;
        } catch (error) {
            Utils.showNotification('Failed to delete session', 'error');
        }
    },

    /**
     * Send message
     */
    async sendMessage(message) {
        if (!message || !AppState.currentSessionId) return;

        const input = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');

        // Disable UI during send
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="loading"></span>';
        input.disabled = true;

        try {
            // Add user message to UI immediately
            AppState.sessions[AppState.currentSessionId].messages.push({
                role: 'user',
                content: message,
                timestamp: new Date().toISOString()
            });

            UIRenderer.renderMessages(AppState.sessions[AppState.currentSessionId].messages);
            input.value = '';

            // Send to backend
            const response = await ApiService.sendMessage(
                AppState.currentAgent,
                AppState.currentUserId,
                AppState.currentSessionId,
                message
            );

            if (response.status === 'success' && response.response) {
                // Add assistant response
                AppState.sessions[AppState.currentSessionId].messages.push({
                    role: 'assistant',
                    content: response.response,
                    full_response: response.full_response,
                    timestamp: new Date().toISOString()
                });

                // Re-render all messages
                UIRenderer.renderMessages(AppState.sessions[AppState.currentSessionId].messages);
            } else {
                Utils.showNotification('Failed to get response from agent', 'error');
            }
        } catch (error) {
            Utils.showNotification('Failed to send message', 'error');
        } finally {
            // Re-enable UI
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
            input.disabled = false;
            input.focus();
        }
    },

    /**
     * Set up all event listeners
     */
    setupEventListeners() {
        // Message form submission
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            await this.sendMessage(message);
        });

        // New session button
        document.getElementById('newSessionBtn').addEventListener('click', () => {
            this.createNewSession();
        });

        // Delete session button
        document.getElementById('deleteSessionBtn').addEventListener('click', () => {
            this.deleteCurrentSession();
        });

        // Agent selector change
        document.getElementById('agentSelector').addEventListener('change', (e) => {
            AppState.currentAgent = e.target.value;
            AppState.currentSessionId = null;
            AppState.sessions = {};

            if (AppState.currentAgent) {
                this.loadSessions();
            } else {
                UIRenderer.renderSessions(
                    AppState.sessions,
                    AppState.currentSessionId,
                    this.selectSession.bind(this)
                );
            }

            UIRenderer.updateUIState(false);
        });
    }
};

// ============================================
// Initialize Application
// ============================================

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    AppController.init().catch(error => {
        console.error('Failed to initialize application:', error);
    });
});