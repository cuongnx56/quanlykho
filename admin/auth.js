const AUTH_STORAGE_KEY = "admin_session_v1";

function defaultSession_(overrides) {
  return Object.assign(
    {
      apiUrl: "",
      apiKey: "",
      token: "",
      email: "",
      role: ""
    },
    overrides || {}
  );
}

function loadSession_(defaults) {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return defaultSession_(defaults);
    const parsed = JSON.parse(raw);
    return Object.assign(defaultSession_(defaults), parsed || {});
  } catch (err) {
    return defaultSession_(defaults);
  }
}

function saveSession_(session) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearSession_() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

window.AuthSession = {
  load: loadSession_,
  save: saveSession_,
  clear: clearSession_,
  defaults: defaultSession_
};
