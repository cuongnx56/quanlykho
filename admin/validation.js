/**
 * Common Validation Library for Admin Pages
 * 
 * Provides reusable validation functions for:
 * - String fields (with min/max length)
 * - Number fields (with min/max value)
 * - Email fields
 * - Phone fields
 * - URL fields
 * - Textarea fields
 * - Custom pattern validation
 * 
 * Usage:
 *   const rules = {
 *     name: { required: true, minLength: 2, maxLength: 100 },
 *     price: { required: true, type: 'number', min: 0, max: 999999 },
 *     email: { required: true, type: 'email' },
 *     phone: { type: 'phone' },
 *     url: { type: 'url' }
 *   };
 *   
 *   const result = Validator.validateForm(formData, rules);
 *   if (!result.valid) {
 *     Validator.showErrors(result.errors);
 *     return;
 *   }
 */

const Validator = {
  /**
   * Default length limits (có thể ghi đè ở case cụ thể)
   */
  limits: {
    ID_MAX_LENGTH: 15,        // Tối đa cho các field dạng ID
    STRING_MAX_LENGTH: 50,    // Tối đa cho các field dạng string
    TEXTAREA_MAX_LENGTH: 100  // Tối đa cho các field dạng textarea
  },

  /**
   * Default error messages (Vietnamese)
   */
  messages: {
    required: 'Trường này là bắt buộc',
    minLength: 'Tối thiểu {min} ký tự',
    maxLength: 'Tối đa {max} ký tự',
    min: 'Giá trị tối thiểu là {min}',
    max: 'Giá trị tối đa là {max}',
    email: 'Email không hợp lệ',
    phone: 'Số điện thoại không hợp lệ',
    url: 'URL không hợp lệ',
    pattern: 'Giá trị không đúng định dạng',
    number: 'Phải là số',
    integer: 'Phải là số nguyên',
    positive: 'Phải là số dương',
    nonNegative: 'Phải là số >= 0'
  },

  /**
   * Validate a single field
   * @param {*} value - Field value
   * @param {Object} rules - Validation rules
   * @param {string} fieldName - Field name (for error messages)
   * @returns {Object} { valid: boolean, error: string|null }
   */
  validateField(value, rules, fieldName = '') {
    // Convert value to string for length checks, but keep original for number checks
    const strValue = String(value || '').trim();
    const isEmpty = strValue === '' || value === null || value === undefined;

    // Required check
    if (rules.required && isEmpty) {
      return {
        valid: false,
        error: this.messages.required
      };
    }

    // If not required and empty, skip other validations
    if (!rules.required && isEmpty) {
      return { valid: true, error: null };
    }

    // Type-specific validation
    if (rules.type) {
      const typeResult = this.validateType(value, rules.type, rules);
      if (!typeResult.valid) {
        return typeResult;
      }
    }

    // String length validation
    if (rules.minLength !== undefined) {
      if (strValue.length < rules.minLength) {
        return {
          valid: false,
          error: this.messages.minLength.replace('{min}', rules.minLength)
        };
      }
    }

    if (rules.maxLength !== undefined) {
      if (strValue.length > rules.maxLength) {
        return {
          valid: false,
          error: this.messages.maxLength.replace('{max}', rules.maxLength)
        };
      }
    }

    // Number range validation
    if (rules.type === 'number' || rules.type === 'integer') {
      const numValue = Number(value);
      if (isNaN(numValue)) {
        return {
          valid: false,
          error: this.messages.number
        };
      }

      if (rules.min !== undefined && numValue < rules.min) {
        return {
          valid: false,
          error: this.messages.min.replace('{min}', rules.min)
        };
      }

      if (rules.max !== undefined && numValue > rules.max) {
        return {
          valid: false,
          error: this.messages.max.replace('{max}', rules.max)
        };
      }

      if (rules.positive && numValue <= 0) {
        return {
          valid: false,
          error: this.messages.positive
        };
      }

      if (rules.nonNegative && numValue < 0) {
        return {
          valid: false,
          error: this.messages.nonNegative
        };
      }
    }

    // Pattern validation (regex)
    if (rules.pattern) {
      const regex = new RegExp(rules.pattern);
      if (!regex.test(strValue)) {
        return {
          valid: false,
          error: rules.patternMessage || this.messages.pattern
        };
      }
    }

    // Custom validator function
    if (rules.validator && typeof rules.validator === 'function') {
      const customResult = rules.validator(value, rules);
      if (customResult !== true && customResult !== null) {
        return {
          valid: false,
          error: typeof customResult === 'string' ? customResult : this.messages.pattern
        };
      }
    }

    return { valid: true, error: null };
  },

  /**
   * Validate type-specific formats
   * @param {*} value - Field value
   * @param {string} type - Type: 'email', 'phone', 'url', 'number', 'integer'
   * @param {Object} rules - Additional rules
   * @returns {Object} { valid: boolean, error: string|null }
   */
  validateType(value, type, rules = {}) {
    const strValue = String(value || '').trim();

    switch (type) {
      case 'email':
        // RFC 5322 simplified regex
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(strValue)) {
          return {
            valid: false,
            error: this.messages.email
          };
        }
        break;

      case 'phone':
        // Vietnamese phone: 10-11 digits, may start with 0 or +84
        const phoneRegex = /^(\+84|0)[1-9][0-9]{8,9}$/;
        const cleanPhone = strValue.replace(/[\s\-\(\)]/g, '');
        if (!phoneRegex.test(cleanPhone)) {
          return {
            valid: false,
            error: this.messages.phone
          };
        }
        break;

      case 'url':
        try {
          new URL(strValue);
        } catch (e) {
          // Also accept relative URLs or URLs without protocol
          if (!strValue.startsWith('http://') && !strValue.startsWith('https://') && !strValue.startsWith('/')) {
            return {
              valid: false,
              error: this.messages.url
            };
          }
        }
        break;

      case 'number':
        const numValue = Number(value);
        if (isNaN(numValue)) {
          return {
            valid: false,
            error: this.messages.number
          };
        }
        break;

      case 'integer':
        const intValue = Number(value);
        if (isNaN(intValue) || !Number.isInteger(intValue)) {
          return {
            valid: false,
            error: this.messages.integer
          };
        }
        break;
    }

    return { valid: true, error: null };
  },

  /**
   * Validate entire form data
   * @param {Object} data - Form data object
   * @param {Object} rules - Rules object: { fieldName: { rules... }, ... }
   * @returns {Object} { valid: boolean, errors: { fieldName: errorMessage } }
   */
  validateForm(data, rules) {
    const errors = {};
    let isValid = true;

    for (const fieldName in rules) {
      if (!rules.hasOwnProperty(fieldName)) continue;

      const fieldRules = rules[fieldName];
      const value = data[fieldName];
      const result = this.validateField(value, fieldRules, fieldName);

      if (!result.valid) {
        errors[fieldName] = result.error;
        isValid = false;
      }
    }

    return {
      valid: isValid,
      errors: errors
    };
  },

  /**
   * Show validation errors in the UI
   * @param {Object} errors - Errors object: { fieldName: errorMessage }
   * @param {Object} options - Options: { errorClass: 'error', clearOnSuccess: true }
   */
  showErrors(errors, options = {}) {
    const errorClass = options.errorClass || 'validation-error';
    const clearOnSuccess = options.clearOnSuccess !== false;

    // Clear all existing errors first
    if (clearOnSuccess) {
      this.clearErrors();
    }

    // Show errors for each field
    for (const fieldName in errors) {
      if (!errors.hasOwnProperty(fieldName)) continue;

      const errorMessage = errors[fieldName];
      this.showError(fieldName, errorMessage, errorClass);
    }
  },

  /**
   * Show error for a single field
   * @param {string} fieldName - Field name (ID or name attribute)
   * @param {string} errorMessage - Error message to display
   * @param {string} errorClass - CSS class for error styling
   */
  showError(fieldName, errorMessage, errorClass = 'validation-error') {
    // Try to find element by ID first
    let field = document.getElementById(fieldName);
    
    // If not found, try by name attribute
    if (!field) {
      field = document.querySelector(`[name="${fieldName}"]`);
    }

    if (!field) {
      console.warn(`Field not found: ${fieldName}`);
      return;
    }

    // Add error class to field
    field.classList.add(errorClass);

    // Find or create error message element
    let errorElement = field.parentElement.querySelector(`.${errorClass}-message`);
    
    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.className = `${errorClass}-message`;
      // Insert after the field or its wrapper
      const wrapper = field.closest('.form-group') || field.parentElement;
      if (wrapper) {
        wrapper.appendChild(errorElement);
      } else {
        field.parentElement.insertBefore(errorElement, field.nextSibling);
      }
    }

    errorElement.textContent = errorMessage;
    errorElement.style.display = 'block';
    errorElement.style.color = '#ef4444';
    errorElement.style.fontSize = '12px';
    errorElement.style.marginTop = '4px';
  },

  /**
   * Clear all validation errors
   * @param {string} errorClass - CSS class for error styling
   */
  clearErrors(errorClass = 'validation-error') {
    // Remove error class from all fields
    document.querySelectorAll(`.${errorClass}`).forEach(field => {
      field.classList.remove(errorClass);
    });

    // Remove all error messages
    document.querySelectorAll(`.${errorClass}-message`).forEach(msg => {
      msg.remove();
    });
  },

  /**
   * Clear error for a single field
   * @param {string} fieldName - Field name (ID or name attribute)
   * @param {string} errorClass - CSS class for error styling
   */
  clearError(fieldName, errorClass = 'validation-error') {
    const field = document.getElementById(fieldName) || document.querySelector(`[name="${fieldName}"]`);
    if (field) {
      field.classList.remove(errorClass);
    }

    const errorElement = field?.parentElement?.querySelector(`.${errorClass}-message`);
    if (errorElement) {
      errorElement.remove();
    }
  },

  /**
   * Quick validation helpers for common cases
   */
  helpers: {
    /**
     * Required ID field (max 15 ký tự)
     */
    requiredId(minLength = 1, maxLength = null) {
      return {
        required: true,
        minLength: minLength,
        maxLength: maxLength !== null ? maxLength : Validator.limits.ID_MAX_LENGTH
      };
    },

    /**
     * Optional ID field (max 15 ký tự)
     */
    optionalId(maxLength = null) {
      return {
        required: false,
        maxLength: maxLength !== null ? maxLength : Validator.limits.ID_MAX_LENGTH
      };
    },

    /**
     * Required string with length limits (default max 50)
     */
    requiredString(minLength = 1, maxLength = null) {
      return {
        required: true,
        minLength: minLength,
        maxLength: maxLength !== null ? maxLength : Validator.limits.STRING_MAX_LENGTH
      };
    },

    /**
     * Optional string with length limits (default max 50)
     */
    optionalString(maxLength = null) {
      return {
        required: false,
        maxLength: maxLength !== null ? maxLength : Validator.limits.STRING_MAX_LENGTH
      };
    },

    /**
     * Required number with range
     */
    requiredNumber(min = 0, max = 999999) {
      return {
        required: true,
        type: 'number',
        min: min,
        max: max
      };
    },

    /**
     * Required positive number
     */
    requiredPositiveNumber(max = 999999) {
      return {
        required: true,
        type: 'number',
        positive: true,
        max: max
      };
    },

    /**
     * Required non-negative number (>= 0)
     */
    requiredNonNegativeNumber(max = 999999) {
      return {
        required: true,
        type: 'number',
        nonNegative: true,
        max: max
      };
    },

    /**
     * Required email
     */
    requiredEmail() {
      return {
        required: true,
        type: 'email'
      };
    },

    /**
     * Optional email
     */
    optionalEmail() {
      return {
        required: false,
        type: 'email'
      };
    },

    /**
     * Required phone
     */
    requiredPhone() {
      return {
        required: true,
        type: 'phone'
      };
    },

    /**
     * Optional phone
     */
    optionalPhone() {
      return {
        required: false,
        type: 'phone'
      };
    },

    /**
     * Required URL
     */
    requiredUrl() {
      return {
        required: true,
        type: 'url'
      };
    },

    /**
     * Optional URL
     */
    optionalUrl() {
      return {
        required: false,
        type: 'url'
      };
    },

    /**
     * Textarea with length limits (default max 100)
     */
    textarea(required = false, maxLength = null) {
      return {
        required: required,
        maxLength: maxLength !== null ? maxLength : Validator.limits.TEXTAREA_MAX_LENGTH
      };
    }
  }
};

// Export to window
window.Validator = Validator;
