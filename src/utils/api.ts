export const apiFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = localStorage.getItem('aetheros_token');
  
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Dispatch an event so the Auth Overlay can catch it and force a re-login
    window.dispatchEvent(new Event('auth:unauthorized'));
  }

  return response;
};
