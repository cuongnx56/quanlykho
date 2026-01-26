const API_URL = "https://script.google.com/macros/s/AKfycbzs7FiPxCy0Offo90kG3MqrfkgjilhI25AsrEh09TzF7A_PPsxs3C_Xq4ifCLKiQdIR/exec";

async function onboard() {
  const data = {
    shop_name: document.getElementById("shop_name").value.trim(),
    owner_email: document.getElementById("owner_email").value.trim(),
    owner_password: document.getElementById("owner_password").value,
    sheet_id: document.getElementById("sheet_id").value.trim(),
    plan: document.getElementById("plan").value
  };

  if (!data.shop_name || !data.owner_email || !data.owner_password) {
    alert("Vui lòng nhập đủ thông tin");
    return;
  }

  const resultBox = document.getElementById("result");
  const btnCreate = document.getElementById("btn-create");
  
  Loading.button(btnCreate, true);
  Loading.show("Đang tạo shop...");
  
  resultBox.style.display = "none";

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        action: "system.onboard",
        data
      })
    });

    const json = await res.json();

    if (!json.success) {
      throw json.error;
    }

    Loading.hide();
    
    const productsUrl = `/admin/products.html?api_url=${encodeURIComponent(API_URL)}&api_key=${encodeURIComponent(json.data.api_key)}&email=${encodeURIComponent(data.owner_email)}`;
    const hasSheetId = data.sheet_id && data.sheet_id.trim() !== "";
    
    btnCreate.disabled = true;
    btnCreate.classList.remove('loading');
    btnCreate.textContent = "✅ Đã tạo shop";
    
    const resultBox = document.getElementById("result");
    resultBox.style.display = "block";
    resultBox.className = "result-box success";
    
    let sheetSection = "";
    let sheetInstructions = "";
    let sheetButton = "";
    
    if (hasSheetId) {
      sheetSection = `
        <div class="result-info">
          <strong>Google Sheet</strong>
          <div class="value"><a href="${json.data.sheet_url}" target="_blank">${json.data.sheet_url}</a></div>
        </div>
      `;
      
      sheetInstructions = `
        <li>Mở Google Sheet bằng link trên</li>
        <li>Click <strong>Share</strong> và cấp quyền <strong>Editor</strong> cho email: <strong>nguyenxuancuongk56@gmail.com</strong></li>
      `;
      
      sheetButton = `
        <button type="button" onclick="window.open('${json.data.sheet_url}', '_blank')" style="background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);">
          📊 Mở Google Sheet
        </button>
      `;
    }
    
    resultBox.innerHTML = `
      <div class="result-title">
        ✅ Tạo shop thành công!
      </div>
      
      <div class="result-content">
        <div class="instructions" style="background: rgba(239, 68, 68, 0.1); border-left-color: #ef4444;">
          <h4>⚠️ Quan trọng:</h4>
          <p style="color: #991b1b; font-weight: 600;">Vui lòng lưu lại các thông tin đăng nhập và API Key bên dưới. Bạn sẽ cần chúng để quản lý shop.</p>
        </div>
        
        <div class="result-info">
          <strong>Shop Name</strong>
          <div class="value">${data.shop_name}</div>
        </div>
        
        <div class="result-info">
          <strong>Admin Email</strong>
          <div class="value">${data.owner_email}</div>
        </div>
        
        <div class="result-info">
          <strong>Admin Password</strong>
          <div class="value">${data.owner_password}</div>
        </div>
        
        <div class="result-info">
          <strong>API Key (quan trọng)</strong>
          <div class="value">${json.data.api_key}</div>
        </div>
        
        ${sheetSection}
        
        <div class="instructions">
          <h4>📝 Hướng dẫn tiếp theo:</h4>
          <ol>
            ${sheetInstructions}
            <li>Click nút bên dưới để vào Dashboard quản trị</li>
          </ol>
        </div>
        
        <div class="result-actions">
          <button type="button" onclick="window.location.href='${productsUrl}'">
            🎛️ Mở Dashboard quản trị
          </button>
          ${sheetButton}
        </div>
      </div>
    `;

  } catch (err) {
    Loading.hide();
    Loading.button(btnCreate, false);
    
    const resultBox = document.getElementById("result");
    resultBox.style.display = "block";
    resultBox.className = "result-box error";
    resultBox.innerHTML = `
      <div class="result-title">
        ❌ Tạo shop thất bại
      </div>
      <div class="result-content">
        <div class="result-info">
          <strong>Lỗi:</strong>
          <div class="value">${err}</div>
        </div>
        <div style="margin-top: 16px; font-size: 13px; color: #991b1b;">
          Vui lòng kiểm tra lại thông tin và thử lại.
        </div>
      </div>
    `;
  }
}
