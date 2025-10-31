# Sherpa Deployment Error Fix

## Issue
When deployed on Sherpa, uploading a file returns:
```
❌ Error: Unexpected token '<', "
```

This error occurs when the server returns HTML (like an error page) instead of JSON.

## Root Causes & Fixes

### 1. Missing Error Handling
**Problem**: Server errors weren't being caught and returned as proper JSON responses.

**Fix**: Added comprehensive error handling:
```javascript
app.post('/start', upload.single('file'), async (req, res) => {
    try {
        // All upload logic
    } catch (error) {
        console.error('Error in /start endpoint:', error);
        res.status(500).json({ 
            ok: false, 
            error: error.message || 'Internal server error' 
        });
    }
});
```

### 2. No File Validation
**Problem**: No check if file was actually uploaded.

**Fix**: Added file validation:
```javascript
if (!req.file) {
    console.error('No file uploaded');
    return res.status(400).json({ 
        ok: false, 
        error: 'No file uploaded' 
    });
}
```

### 3. Global Error Handler Missing
**Problem**: Unhandled errors crash the server or return HTML error pages.

**Fix**: Added global error handlers:
```javascript
// Handle multer errors
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ 
            ok: false, 
            error: `Upload error: ${err.message}` 
        });
    }
    res.status(500).json({ 
        ok: false, 
        error: err.message || 'Internal server error' 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        ok: false, 
        error: 'Endpoint not found' 
    });
});
```

### 4. Frontend Not Checking Response Type
**Problem**: Frontend assumes response is always JSON.

**Fix**: Added content-type validation:
```javascript
const contentType = response.headers.get('content-type');
if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    console.error('Non-JSON response:', text);
    throw new Error('Server returned an invalid response. Check server logs.');
}
```

### 5. Missing Middleware
**Problem**: Missing JSON parsing and body parsing middleware.

**Fix**: Added required middleware:
```javascript
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
```

### 6. Better Multer Configuration
**Problem**: No file size limits or proper configuration.

**Fix**: Enhanced multer setup:
```javascript
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
    }
});
```

### 7. Better Logging
**Problem**: Hard to debug issues on Sherpa.

**Fix**: Added console.log statements:
```javascript
console.log('Uploaded file:', req.file.originalname);
console.log('Processing ZIP file...');
console.log('Processing spec file...');
console.log('Run created:', runId);
console.error('Invalid file type:', file.originalname);
```

## Testing

### Local Testing
```bash
# Rebuild and test
docker-compose up --build

# Upload a file at http://localhost:3000
# Check console logs for any errors
```

### Sherpa Testing
```bash
# Check Sherpa logs after uploading:
# Should see: "Uploaded file: <filename>"
# Should NOT see HTML error pages

# If errors occur, logs will show:
# - "No file uploaded" 
# - "Invalid file type"
# - "Error in /start endpoint: <message>"
```

## Common Sherpa Issues

### If still getting errors:

1. **Check file size**: Sherpa may have lower limits
   - Reduce `MAX_FILE_SIZE_MB` in environment

2. **Check request body size**: Sherpa may limit request size
   - May need to adjust Express body size limits

3. **Check CORS**: Sherpa may have different origin
   - Verify CORS settings in deployment

4. **Check paths**: Sherpa may have different directory permissions
   - Verify `/app/runs` directory is writable

## Files Modified

1. **`server/index.js`**
   - Added try-catch to `/start` endpoint
   - Added file validation
   - Added global error handlers
   - Added better logging
   - Enhanced multer configuration
   - Added middleware for JSON parsing

2. **`public/index.html`**
   - Added content-type checking
   - Better error messages
   - Console logging for debugging

## Deployment Checklist

- [x] Error handling in place
- [x] File validation added
- [x] Global error handlers
- [x] Response type checking
- [x] Logging statements
- [x] JSON parsing middleware
- [ ] Test on Sherpa with actual file upload
- [ ] Check Sherpa logs for any errors
- [ ] Verify environment variables are set

---

**This should fix the Sherpa deployment error!** 🚀

If issues persist, check Sherpa's deployment logs for the actual error message.
