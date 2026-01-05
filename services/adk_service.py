import requests
import re
import json
from typing import Dict, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

class ADKService:
    def __init__(self, api_base: str):
        self.api_base = api_base
    
    def list_agents(self) -> list:
        try:
            response = requests.get(f'{self.api_base}/list-apps', timeout=5)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            logger.error(f"Failed to fetch agents: {e}")
            return []
    
    def create_session(self, agent: str, user_id: str, session_id: str) -> bool:
        try:
            response = requests.post(
                f'{self.api_base}/apps/{agent}/users/{user_id}/sessions/{session_id}',
                json={},
                timeout=5
            )
            response.raise_for_status()
            return True
        except requests.RequestException as e:
            logger.error(f"Failed to create session: {e}")
            return False
    
    def delete_session(self, agent: str, user_id: str, session_id: str):
        try:
            response = requests.delete(
                f'{self.api_base}/apps/{agent}/users/{user_id}/sessions/{session_id}',
                timeout=5
            )
            # Don't raise error for delete - it might fail if session doesn't exist
            return response.ok
        except requests.RequestException as e:
            logger.error(f"Failed to delete session: {e}")
            return False
    
    def send_message(self, agent: str, user_id: str, session_id: str, 
                    message: str) -> Tuple[Optional[str], Optional[dict]]:
        payload = {
            'appName': agent,
            'userId': user_id,
            'sessionId': session_id,
            'newMessage': {
                'role': 'user',
                'parts': [{'text': message}]
            }
        }
        
        try:
            response = requests.post(
                f'{self.api_base}/run',
                json=payload,
                timeout=600
            )
            response.raise_for_status()
            
            response_data = response.json()
            assistant_response = self._extract_assistant_response(response_data)
            
            return assistant_response, response_data
            
        except requests.Timeout:
            logger.error("Request timed out")
            return None, None
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            return None, None
    
    def _extract_assistant_response(self, response_data: list) -> str:
        """Extract text from assistant response."""
        assistant_response = ""
        
        if not isinstance(response_data, list):
            return assistant_response
            
        for event in response_data:
            if isinstance(event, dict):
                content = event.get('content', {})
                if isinstance(content, dict):
                    parts = content.get('parts', [])
                    if isinstance(parts, list):
                        for part in parts:
                            if isinstance(part, dict):
                                text = part.get('text')
                                if text:
                                    assistant_response += str(text)
        
        return assistant_response
    
    def extract_analytics_data(self, response_data: list) -> Optional[dict]:
        """Extract and parse analytics data from response."""
        for event in response_data:
            if isinstance(event, dict):
                actions = event.get('actions', {})
                if isinstance(actions, dict):
                    state_delta = actions.get('stateDelta')
                    if isinstance(state_delta, dict) and state_delta.get('analytics_output'):
                        analytics_output = state_delta['analytics_output']
                        
                        # Try to parse as JSON from markdown code block
                        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', str(analytics_output))
                        if json_match:
                            try:
                                return json.loads(json_match.group(1))
                            except json.JSONDecodeError:
                                # Try to fix common JSON issues
                                fixed_json = self._fix_json(json_match.group(1))
                                try:
                                    return json.loads(fixed_json)
                                except json.JSONDecodeError:
                                    logger.error("Failed to parse JSON after fixing")
                        # Check if already a dict
                        elif isinstance(analytics_output, dict):
                            return analytics_output
                        # Try parsing as raw JSON string
                        else:
                            try:
                                return json.loads(str(analytics_output))
                            except json.JSONDecodeError:
                                logger.error("Failed to parse raw analytics output")
        
        return None
    
    def _fix_json(self, json_str: str) -> str:
        """Fix common JSON issues."""
        # Remove trailing commas before } or ]
        fixed = re.sub(r',(\s*[}\]])', r'\1', json_str)
        # Normalize whitespace
        fixed = ' '.join(fixed.split())
        return fixed