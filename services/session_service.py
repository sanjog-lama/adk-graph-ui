from datetime import datetime
from typing import Dict, Optional

class SessionService:
    def __init__(self):
        self._sessions_store: Dict[str, Dict] = {}
    
    def get_sessions_key(self, agent: str, user_id: str) -> str:
        return f"{agent}:{user_id}"
    
    def get_user_sessions(self, agent: str, user_id: str) -> Dict:
        key = self.get_sessions_key(agent, user_id)
        return self._sessions_store.get(key, {})
    
    def create_session(self, agent: str, user_id: str, session_id: str) -> Dict:
        key = self.get_sessions_key(agent, user_id)
        self._sessions_store.setdefault(key, {})[session_id] = {
            'created': datetime.now().isoformat(),
            'messages': []
        }
        return self._sessions_store[key][session_id]
    
    def delete_session(self, agent: str, user_id: str, session_id: str):
        key = self.get_sessions_key(agent, user_id)
        if key in self._sessions_store:
            self._sessions_store[key].pop(session_id, None)
    
    def add_message(self, agent: str, user_id: str, session_id: str, 
                   role: str, content: str, full_response: Optional[dict] = None):
        key = self.get_sessions_key(agent, user_id)
        if key not in self._sessions_store:
            self._sessions_store[key] = {}
        if session_id not in self._sessions_store[key]:
            self._sessions_store[key][session_id] = {'messages': []}
        
        self._sessions_store[key][session_id]['messages'].append({
            'role': role,
            'content': content,
            'full_response': full_response,
            'timestamp': datetime.now().isoformat()
        })
    
    def get_messages(self, agent: str, user_id: str, session_id: str):
        key = self.get_sessions_key(agent, user_id)
        sessions = self._sessions_store.get(key, {})
        session = sessions.get(session_id, {})
        return session.get('messages', [])