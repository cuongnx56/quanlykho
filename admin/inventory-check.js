// Use common utilities from common.js
// DEFAULT_API_URL, sessionDefaults, and session are already declared in common.js
// Just use them directly (they're in global scope) or reference via window.CommonUtils
// No need to redeclare - they're already available

// syncInputsFromSession, applyQueryParams_, resetSession, apiCall are now from common.js

function setResult(message, type) {
  const box = byId("result");
  box.classList.remove("success", "error");
  if (type) box.classList.add(type);
  box.textContent = message;
}

async function login() {
  // session is from common.js global scope
  session.apiUrl = window.CommonUtils.DEFAULT_API_URL;
  session.apiKey = byId("api_key").value.trim();
  session.email = byId("email").value.trim();
  const password = byId("password").value;

  if (!session.apiKey || !session.email || !password) {
    alert("Vui lòng nhập đủ API KEY, email, password");
    return;
  }

  const data = await apiCall("auth.login", {
    email: session.email,
    password
  });

  session.token = data.token;
  session.email = data.email;
  session.role = data.role;
  window.AuthSession.save(session);
  
  // Update common session
  if (window.CommonUtils) {
    window.CommonUtils.session = session;
  }
  
  updateSessionUI();
  setResult("Đăng nhập thành công. Nhập ID sản phẩm để kiểm tra tồn.", "success");
}

async function checkStock() {
  if (!session.token) {
    alert("Vui lòng đăng nhập trước");
    return;
  }
  var productId = byId("product_id").value.trim();
  if (!productId) {
    setResult("Vui lòng nhập mã sản phẩm.", "error");
    return;
  }
  const data = await apiCall("inventory.check", {
    token: session.token,
    product_id: productId
  });
  setResult(`Tồn kho hiện tại của ${data.product_id}: ${data.amount_in_stock}`, "success");
}

byId("btn-login").addEventListener("click", async () => {
  const btn = byId("btn-login");
  Loading.button(btn, true);
  try {
    await login();
  } catch (err) {
    setResult(err.message, "error");
  } finally {
    Loading.button(btn, false);
  }
});

byId("btn-check").addEventListener("click", async () => {
  const btn = byId("btn-check");
  Loading.button(btn, true);
  try {
    await checkStock();
  } catch (err) {
    setResult(err.message, "error");
  } finally {
    Loading.button(btn, false);
  }
});

byId("btn-logout").addEventListener("click", () => {
  resetSession();
  setResult("", "");
});

syncInputsFromSession();
applyQueryParams_();
updateSessionUI();
