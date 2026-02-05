# Validation Library Usage Guide

Thư viện validation dùng chung cho tất cả các màn admin (products, orders, inventory, categories, customers, ...).

## Cài đặt

1. Thêm CSS vào HTML:
```html
<link rel="stylesheet" href="validation.css">
```

2. Thêm JS vào HTML (sau common.js):
```html
<script src="validation.js"></script>
```

## Cách sử dụng cơ bản

### 1. Validate một field đơn lẻ

```javascript
const value = document.getElementById('name').value;
const rules = {
  required: true,
  minLength: 2,
  maxLength: 100
};

const result = Validator.validateField(value, rules, 'name');
if (!result.valid) {
  Validator.showError('name', result.error);
  return;
}
```

### 2. Validate toàn bộ form

```javascript
// Định nghĩa rules
const rules = {
  id: { required: true, minLength: 1, maxLength: 50 },
  title: { required: true, minLength: 2, maxLength: 200 },
  price: { required: true, type: 'number', min: 0, max: 999999 },
  email: { required: true, type: 'email' },
  phone: { type: 'phone' },
  description: { required: false, maxLength: 5000 }
};

// Lấy dữ liệu form
const data = {
  id: document.getElementById('id').value,
  title: document.getElementById('title').value,
  price: document.getElementById('price').value,
  email: document.getElementById('email').value,
  phone: document.getElementById('phone').value,
  description: document.getElementById('description').value
};

// Validate
const result = Validator.validateForm(data, rules);
if (!result.valid) {
  Validator.showErrors(result.errors);
  return;
}

// Nếu valid, tiếp tục xử lý...
```

### 3. Sử dụng helper functions

```javascript
const rules = {
  name: Validator.helpers.requiredString(2, 100),
  price: Validator.helpers.requiredPositiveNumber(999999),
  email: Validator.helpers.requiredEmail(),
  phone: Validator.helpers.optionalPhone(),
  notes: Validator.helpers.textarea(false, 5000)
};
```

## Các loại validation

### String validation
```javascript
{
  required: true,           // Bắt buộc
  minLength: 2,            // Tối thiểu 2 ký tự
  maxLength: 100           // Tối đa 100 ký tự
}
```

### Number validation
```javascript
{
  required: true,
  type: 'number',          // Phải là số
  min: 0,                  // Tối thiểu 0
  max: 999999,             // Tối đa 999999
  positive: true,          // Phải là số dương (> 0)
  nonNegative: true        // Phải >= 0
}
```

### Email validation
```javascript
{
  required: true,
  type: 'email'            // Format email hợp lệ
}
```

### Phone validation
```javascript
{
  required: true,
  type: 'phone'            // Số điện thoại VN: 0xxx hoặc +84xxx
}
```

### URL validation
```javascript
{
  required: true,
  type: 'url'              // URL hợp lệ
}
```

### Pattern validation (regex)
```javascript
{
  required: true,
  pattern: '^[A-Z][a-z]+$',  // Regex pattern
  patternMessage: 'Phải bắt đầu bằng chữ hoa'  // Custom message
}
```

### Custom validator function
```javascript
{
  required: true,
  validator: function(value, rules) {
    // Custom logic
    if (value === 'invalid') {
      return 'Giá trị không hợp lệ';
    }
    return true;  // Valid
  }
}
```

## Ví dụ tích hợp vào form

### Ví dụ: Products form

```javascript
async function saveProduct() {
  reloadSession();
  
  // Clear previous errors
  Validator.clearErrors();
  
  // Đọc dữ liệu form
  const data = {
    id: byId('id').value.trim(),
    title: byId('title').value.trim(),
    price: byId('price').value.trim(),
    amount_in_stock: byId('amount_in_stock').value.trim(),
    email: byId('email')?.value.trim() || '',
    phone: byId('phone')?.value.trim() || '',
    description: byId('description')?.value.trim() || ''
  };
  
  // Định nghĩa rules
  const rules = {
    id: Validator.helpers.requiredString(1, 50),
    title: Validator.helpers.requiredString(2, 200),
    price: Validator.helpers.requiredPositiveNumber(999999),
    amount_in_stock: Validator.helpers.requiredNonNegativeNumber(999999),
    email: Validator.helpers.optionalEmail(),
    phone: Validator.helpers.optionalPhone(),
    description: Validator.helpers.textarea(false, 5000)
  };
  
  // Validate
  const result = Validator.validateForm(data, rules);
  if (!result.valid) {
    Validator.showErrors(result.errors);
    return;
  }
  
  // Check session
  if (!session.token) {
    alert("Vui lòng đăng nhập trước");
    return;
  }
  
  // Convert price to number
  data.price = Number(data.price);
  data.amount_in_stock = Number(data.amount_in_stock);
  
  // Continue with API call...
  try {
    if (editMode === "create") {
      data.token = session.token;
      savedProduct = await apiCall("products.create", data);
    } else {
      data.token = session.token;
      savedProduct = await apiCall("products.update", data);
    }
    // ...
  } catch (err) {
    alert("Lỗi: " + err.message);
  }
}
```

### Ví dụ: Orders form

```javascript
async function saveOrder() {
  reloadSession();
  Validator.clearErrors();
  
  const data = {
    customer_name: byId('customer_name').value.trim(),
    customer_phone: byId('customer_phone').value.trim(),
    customer_email: byId('customer_email')?.value.trim() || '',
    total: byId('total').value.trim(),
    status: byId('status').value.trim(),
    note: byId('note')?.value.trim() || ''
  };
  
  const rules = {
    customer_name: Validator.helpers.requiredString(2, 100),
    customer_phone: Validator.helpers.requiredPhone(),
    customer_email: Validator.helpers.optionalEmail(),
    total: Validator.helpers.requiredPositiveNumber(999999999),
    status: { required: true },
    note: Validator.helpers.textarea(false, 1000)
  };
  
  const result = Validator.validateForm(data, rules);
  if (!result.valid) {
    Validator.showErrors(result.errors);
    return;
  }
  
  // Continue...
}
```

### Ví dụ: Categories form

```javascript
async function saveCategory() {
  reloadSession();
  Validator.clearErrors();
  
  const data = {
    id: byId('id').value.trim(),
    name: byId('name').value.trim(),
    description: byId('description')?.value.trim() || ''
  };
  
  const rules = {
    id: Validator.helpers.requiredString(1, 50),
    name: Validator.helpers.requiredString(2, 100),
    description: Validator.helpers.textarea(false, 2000)
  };
  
  const result = Validator.validateForm(data, rules);
  if (!result.valid) {
    Validator.showErrors(result.errors);
    return;
  }
  
  // Continue...
}
```

## API Reference

### `Validator.validateField(value, rules, fieldName)`
Validate một field đơn lẻ.

**Parameters:**
- `value`: Giá trị cần validate
- `rules`: Object chứa các rules
- `fieldName`: Tên field (optional, dùng cho error messages)

**Returns:**
```javascript
{
  valid: boolean,
  error: string | null
}
```

### `Validator.validateForm(data, rules)`
Validate toàn bộ form.

**Parameters:**
- `data`: Object chứa dữ liệu form `{ fieldName: value, ... }`
- `rules`: Object chứa rules cho từng field `{ fieldName: { rules... }, ... }`

**Returns:**
```javascript
{
  valid: boolean,
  errors: { fieldName: errorMessage, ... }
}
```

### `Validator.showErrors(errors, options)`
Hiển thị errors trong UI.

**Parameters:**
- `errors`: Object errors từ `validateForm()`
- `options`: `{ errorClass: 'validation-error', clearOnSuccess: true }`

### `Validator.showError(fieldName, errorMessage, errorClass)`
Hiển thị error cho một field.

**Parameters:**
- `fieldName`: ID hoặc name attribute của field
- `errorMessage`: Message hiển thị
- `errorClass`: CSS class (default: 'validation-error')

### `Validator.clearErrors(errorClass)`
Xóa tất cả errors.

### `Validator.clearError(fieldName, errorClass)`
Xóa error cho một field.

### `Validator.helpers`
Các helper functions để tạo rules nhanh:
- `requiredString(minLength, maxLength)`
- `optionalString(maxLength)`
- `requiredNumber(min, max)`
- `requiredPositiveNumber(max)`
- `requiredNonNegativeNumber(max)`
- `requiredEmail()`
- `optionalEmail()`
- `requiredPhone()`
- `optionalPhone()`
- `requiredUrl()`
- `optionalUrl()`
- `textarea(required, maxLength)`

## Customization

### Thay đổi error messages

```javascript
Validator.messages.required = 'Trường này không được để trống';
Validator.messages.email = 'Email sai định dạng';
// ...
```

### Thay đổi CSS class

```javascript
Validator.showErrors(result.errors, {
  errorClass: 'my-custom-error-class'
});
```

## Best Practices

1. **Luôn clear errors trước khi validate:**
   ```javascript
   Validator.clearErrors();
   const result = Validator.validateForm(data, rules);
   ```

2. **Sử dụng helper functions để code ngắn gọn:**
   ```javascript
   const rules = {
     name: Validator.helpers.requiredString(2, 100),
     price: Validator.helpers.requiredPositiveNumber()
   };
   ```

3. **Validate trước khi gọi API:**
   ```javascript
   const result = Validator.validateForm(data, rules);
   if (!result.valid) {
     Validator.showErrors(result.errors);
     return;  // Dừng lại, không gọi API
   }
   // Tiếp tục gọi API...
   ```

4. **Convert types sau khi validate:**
   ```javascript
   // Validate trước
   const result = Validator.validateForm(data, rules);
   if (!result.valid) return;
   
   // Convert types sau
   data.price = Number(data.price);
   data.amount_in_stock = Number(data.amount_in_stock);
   ```
