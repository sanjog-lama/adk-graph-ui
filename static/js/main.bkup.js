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
    },

    /**
     * Get current user
     */
    async getCurrentUser() {
        return await this.fetchWithError('/auth/current-user');
    },

    /**
     * Send message with streaming (SSE)
     */
    async sendMessageStreaming(agent, userId, sessionId, message, callbacks) {
        const { onEvent, onComplete, onError } = callbacks;
        let completed = false;

        try {
            const response = await fetch('/api/send-message-sse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent, userId, sessionId, message })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    Utils.log('SSE', 'Stream reader done');
                    if (!completed && onComplete) {
                        completed = true;
                        onComplete();
                    }
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;

                    const data = line.slice(6).trim();
                    if (!data) continue;

                    try {
                        const event = JSON.parse(data);

                        if (event.type === 'error') {
                            Utils.error('SSE', 'Error event:', event.message);
                            if (onError) onError(new Error(event.message));
                            break;
                        }

                        if (event.type === 'complete') {
                            Utils.log('SSE', 'Received completion event');
                            if (!completed && onComplete) {
                                completed = true;
                                onComplete();
                            }
                            break;
                        }

                        if (onEvent) onEvent(event);

                    } catch (err) {
                        Utils.error('SSE', 'Failed to parse event:', err, data);
                    }
                }
            }
        } catch (error) {
            Utils.error('SSE', 'Streaming error:', error);
            if (onError) onError(error);
            throw error;
        }
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
        if (fullResponse && Array.isArray(fullResponse)) {
            for (const event of fullResponse) {
                const possiblePaths = [
                    event?.actions?.stateDelta?.analytics_output,
                    event?.stateDelta?.analytics_output,
                    event?.analytics_output
                ];

                for (const data of possiblePaths) {
                    if (data !== undefined && data !== null) {
                        Utils.log('AnalyticsParser', 'Found analytics_output in full_response');
                        return this.parseAnalyticsData(data);
                    }
                }
            }
        }
        
        if (typeof fullResponse === 'string') {
            return this.extractFromContentString(fullResponse);
        }

        return null;
    },

    extractFromContentString(content) {
        // Try fenced ```json blocks first
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

        // Fallback: extract LAST JSON object
        try {
            const jsonObjectRegex = /\{[\s\S]*?\}(?=\s*\{|\s*$)/g;
            const matches = content.match(jsonObjectRegex) || [];

            for (let i = matches.length - 1; i >= 0; i--) {
                try {
                    const parsed = JSON.parse(matches[i]);
                    if (this.isAnalyticsData(parsed)) {
                        Utils.log('AnalyticsParser', 'Extracted analytics from multiple JSON blocks');
                        return parsed;
                    }
                } catch (e) {
                    // continue
                }
            }
        } catch (err) {}

        return null;
    },

    isAnalyticsData(data) {
        return data && typeof data === 'object' && (
            data.hasOwnProperty('visualization_hints') ||
            data.hasOwnProperty('analysis_summary') ||
            data.hasOwnProperty('insights') ||
            data.hasOwnProperty('recommendations')
        );
    },

    /**
     * Parse analytics data safely (handles strings, objects, and JSON code blocks)
     */
    parseAnalyticsData(analyticsData) {
        if (typeof analyticsData === 'object' && analyticsData !== null) {
            return analyticsData;
        }
        
        if (typeof analyticsData === 'string') {
            const codeBlockRegex = /```json([\s\S]*?)```/;
            const match = analyticsData.match(codeBlockRegex);
            let jsonString = match?.[1] || analyticsData;

            try {
                return JSON.parse(jsonString.trim());
            } catch (err) {
                try {
                    const fixedJson = jsonString.replace(/,(\s*[}\]])/g, '$1').trim();
                    return JSON.parse(fixedJson);
                } catch (err2) {
                    return null;
                }
            }
        }

        return null;
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
        const baseId = Date.now();
        visualizationHints.forEach((chart, idx) => {
            const chartDiv = document.createElement('div');
            chartDiv.className = 'chart-container';
            const chartId = `chart-${baseId}-${idx}`;
            chartDiv.innerHTML = `<div id="${chartId}" style="width:100%;height:400px;"></div>`;
            container.appendChild(chartDiv);

            setTimeout(() => this.renderSingleChart(chart, chartId), 50);
        });
    },

    /**
     * Render single chart
     */
    renderSingleChart(chart, chartId) {
        const chartContainer = document.getElementById(chartId);
        if (!chartContainer) return;

        const plotData = this.createPlotData(chart);
        const layout = this.createChartLayout(chart.title);
        Plotly.newPlot(chartContainer, plotData, layout);
    },

    /**
     * Create Plotly plot data based on chart type
     */
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
                onSessionClick(item.dataset.sessionId);
            });
        });
    },

    /**
     * Render messages in chat area
     */
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

        messages.forEach((msg) => {
            if (msg.role === 'assistant') {
                let jsonData = null;
                
                if (msg.full_response) {
                    jsonData = AnalyticsParser.extractAnalyticsData(msg.full_response);
                }
                
                if (!jsonData && msg.content) {
                    jsonData = AnalyticsParser.extractFromContentString(msg.content);
                }

                if (jsonData) {
                    ChartRenderer.renderAnalysisChart(jsonData, container);
                } else {
                    const msgDiv = document.createElement('div');
                    msgDiv.className = 'message assistant';
                    msgDiv.innerHTML = `
                        <div class="message-content">${Utils.formatMessageContent(msg.content)}</div>
                        <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
                    `;
                    container.appendChild(msgDiv);
                }
            } else {
                const msgDiv = document.createElement('div');
                msgDiv.className = 'message user';
                msgDiv.innerHTML = `
                    <div class="message-content">${Utils.formatMessageContent(msg.content)}</div>
                    <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
                `;
                container.appendChild(msgDiv);
            }
        });

        container.scrollTop = container.scrollHeight;
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
                : 'Welcome to BMG Chat';
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

        // try {
        //     const result = await ApiService.getCurrentUser();

        //     if (result.authenticated) {
        //         AppState.currentUser = result.user;

        //         // Use stable ID for sessions
        //         AppState.currentUserId =
        //             result.user.sub ||
        //             result.user.email ||
        //             `user_${Date.now()}`;

        //         if (AppState.currentUser) {
        //             const userDiv = document.getElementById('userInfo');
        //             userDiv.innerHTML = `
        //                 <strong>${Utils.escapeHtml(AppState.currentUser.name)}</strong>
        //                 (${Utils.escapeHtml(AppState.currentUser.email)})
        //             `;
        //         }

        //         Utils.log('AUTH', 'Logged in user:', AppState.currentUser);
        //         Utils.log('AUTH', 'currentUserId:', AppState.currentUserId);
        //     }
        // } catch (err) {
        //     Utils.error('AUTH', 'User not authenticated');
        //     // Optional: redirect to login
        //     // window.location.href = '/login';
        //     return;
        // }

        await this.loadAgents();
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
            AppState.sessions = await ApiService.loadSessions(AppState.currentAgent, AppState.currentUserId);
            UIRenderer.renderSessions(AppState.sessions, AppState.currentSessionId, this.selectSession.bind(this));
        } catch {
            Utils.showNotification('Failed to load sessions', 'error');
        }
    },

    /**
     * Select a session
     */
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
            await ApiService.createSession(AppState.currentAgent, AppState.currentUserId, sessionId);
            AppState.sessions[sessionId] = { created: new Date().toISOString(), messages: [] };
            await this.selectSession(sessionId);
        } catch {
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

    /**
     * SSE-based Send message
     */
    async sendMessage(message) {
        if (!message || !AppState.currentSessionId) return;

        const input = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const messagesContainer = document.getElementById('messagesContainer');

        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="loading"></span>';
        input.disabled = true;

        // Add user message immediately
        const userMessage = {
            role: 'user',
            content: message,
            timestamp: new Date().toISOString()
        };
        
        AppState.sessions[AppState.currentSessionId].messages.push(userMessage);
        
        // Render user message
        const userMsgDiv = document.createElement('div');
        userMsgDiv.className = 'message user';
        userMsgDiv.innerHTML = `
            <div class="message-content">${Utils.formatMessageContent(message)}</div>
            <div class="message-time">${new Date().toLocaleTimeString()}</div>
        `;
        messagesContainer.appendChild(userMsgDiv);
        input.value = '';
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Track current message being streamed
        let currentMessageDiv = null;
        let currentContent = '';
        let fullResponse = [];
        let eventCounter = 0;

        try {
            await ApiService.sendMessageStreaming(
                AppState.currentAgent,
                AppState.currentUserId,
                AppState.currentSessionId,
                message,
                {
                    onEvent: (event) => {
    Utils.log('SSE Event', event);
    fullResponse.push(event);
    eventCounter++;

    // 🔥 CHECK: Skip events with partial: false if we already have the content
    // These are duplicate complete responses from the backend
    if (event.partial === false && currentContent && event.content?.parts) {
        // Check if any part contains text that's already in currentContent
        for (const part of event.content.parts) {
            if (part.text && currentContent.includes(part.text)) {
                Utils.log('Deduplication', 'Skipping duplicate complete response (partial: false)');
                return; // Skip this entire event
            }
        }
    }

    const content = event.content?.parts;
    if (content && Array.isArray(content)) {
        for (const part of content) {
            // ONLY handle text responses - skip tool calls and responses
            if (part.text) {
                if (!currentMessageDiv) {
                    // First text event - create initial message div
                    currentMessageDiv = document.createElement('div');
                    currentMessageDiv.className = 'message assistant';
                    currentMessageDiv.innerHTML = `
                        <div class="message-content"></div>
                        <div class="message-time">${new Date().toLocaleTimeString()}</div>
                    `;
                    messagesContainer.appendChild(currentMessageDiv);
                    currentContent = ''; // Reset content for new div
                }
                
                // Append text to current message
                currentContent += part.text;
                const contentElement = currentMessageDiv.querySelector('.message-content');
                contentElement.innerHTML = Utils.formatMessageContent(currentContent);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
            
            // Silently handle function calls (don't show in UI)
            if (part.functionCall) {
                Utils.log('Tool Call', `Calling ${part.functionCall.name}`);
                // After a tool call, prepare for a new text message
                if (currentContent.trim()) {
                    currentMessageDiv = null;
                    currentContent = '';
                }
            }
            
            // Silently handle function responses (don't show in UI)
            if (part.functionResponse) {
                Utils.log('Tool Result', `${part.functionResponse.name} completed`);
                // After a tool response, prepare for a new text message
                currentMessageDiv = null;
                currentContent = '';
            }
        }
    }
},
                    
                    onComplete: () => {
                        Utils.log('SSE', 'Stream completed');
                        Utils.log('Analytics Check', 'Current content:', currentContent.substring(0, 100) + '...');
                        
                        // Check for analytics data BEFORE storing the message
                        let jsonData = null;

                        // 1️⃣ Always prefer structured analytics from SSE events
                        jsonData = AnalyticsParser.extractAnalyticsData(fullResponse);

                        // 2️⃣ Fallback ONLY if SSE did not contain analytics
                        if (!jsonData && currentContent?.trim().startsWith('{')) {
                            jsonData = AnalyticsParser.extractFromContentString(currentContent);
                        }

                        if (jsonData) {
                            Utils.log('Analytics', 'Found analytics data, will render charts only');
                            
                            // Remove the current message div that contains JSON
                            if (currentMessageDiv) {
                                Utils.log('Analytics', 'Removing JSON message div');
                                currentMessageDiv.remove();
                            }
                            
                            // Store message WITHOUT the JSON content (empty or with a marker)
                            const assistantMessage = {
                                role: 'assistant',
                                content: '[Analytics Chart Rendered]', // Placeholder text
                                full_response: fullResponse,
                                timestamp: new Date().toISOString(),
                                isAnalytics: true // Flag to identify analytics messages
                            };
                            AppState.sessions[AppState.currentSessionId].messages.push(assistantMessage);
                            
                            // Render charts
                            ChartRenderer.renderAnalysisChart(jsonData, messagesContainer);
                        } else {
                            Utils.log('Analytics', 'No analytics data, storing normal message');
                            
                            // Store complete message normally
                            const assistantMessage = {
                                role: 'assistant',
                                content: currentContent,
                                full_response: fullResponse,
                                timestamp: new Date().toISOString()
                            };
                            AppState.sessions[AppState.currentSessionId].messages.push(assistantMessage);
                        }

                        // Re-enable input
                        sendBtn.disabled = false;
                        sendBtn.textContent = 'Send';
                        input.disabled = false;
                        input.focus();
                    },
                    
                    onError: (error) => {
                        Utils.showNotification('Failed to get streaming response', 'error');
                        
                        const errorDiv = document.createElement('div');
                        errorDiv.className = 'message assistant error-message';
                        errorDiv.innerHTML = `
                            <div class="message-content">
                                <span style="color: red;">Error: Failed to get response</span>
                            </div>
                            <div class="message-time">${new Date().toLocaleTimeString()}</div>
                        `;
                        messagesContainer.appendChild(errorDiv);
                        
                        sendBtn.disabled = false;
                        sendBtn.textContent = 'Send';
                        input.disabled = false;
                    }
                }
            );
        } catch (error) {
            Utils.showNotification('Failed to send message', 'error');
            
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

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    AppController.init().catch(error => {
        console.error('Failed to initialize application:', error);
    });
});