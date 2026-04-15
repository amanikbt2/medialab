# 🧠 AI Model Picker - Workflow AI vs External Models

## What's New

MediaLab now allows users to choose which AI model powers the builder:

### Two AI Models Available:

#### 1. **Workflow AI** (Default)

- ✅ Built-in intelligent system using WorkflowBrain
- ✅ Fast, deterministic element insertion
- ✅ No API rate limits
- ✅ Perfect for creative element generation
- ✅ Smart background detection & Unsplash integration
- ✅ No external dependencies

#### 2. **Groq API** (External LLM)

- ✅ Powerful external language model (Mixtral-8x7b)
- ✅ More natural language understanding
- ✅ Better conversational abilities
- ✅ Excellent for complex reasoning
- ✅ Fast inference speeds
- ⚠️ Requires API key configuration
- ⚠️ Subject to rate limits

---

## How to Use

### Switching Models in Chat

1. Open AI Chat (click the AI button or start typing)
2. Look at the header - you'll see **"Workflow AI"** or **"Groq (External)"**
3. Click the dropdown to switch between models
4. Selected model will be used for your next request

```
Model Picker Location:
┌─ MediaLab AI Architect ┐
│ Model: standby         │
│ [Workflow AI ▾]        ← Click to switch
└────────────────────────┘
```

### Example Workflows

**Using Workflow AI (Default):**

```
User: "insert bouncing neon ring with border left"
→ WorkflowBrain analyzes instantly
→ Element appears animated on canvas

User: "make body cat picture"
→ Detects background request
→ Fetches from Unsplash
→ Background applies immediately
```

**Using Groq API (External):**

```
User: "I want a professional dashboard layout with cards"
→ Sends to Groq Mixtral model
→ Advanced reasoning about layout
→ Returns detailed instructions
→ Elements are generated based on response

User: "What's the best way to structure a form?"
→ Conversational response from Groq
→ Detailed design suggestions
```

---

## Setup Guide

### Option 1: Use Default (Workflow AI)

- ✅ No setup needed!
- Workflow AI is built-in and ready to use
- All features work out of the box

### Option 2: Enable Groq API (External Model)

**Step 1: Get Groq API Key**

1. Visit https://console.groq.com
2. Sign up for free account
3. Create API key
4. Copy the key

**Step 2: Configure Environment**
Add to your `.env` file:

```
GROQ_API_KEY=your_groq_api_key_here
```

**Step 3: Restart Application**

```
npm start
```

**Step 4: Test**

- Open AI Chat
- Select "Groq (External)" from model picker
- Try a complex request
- Groq will handle it!

---

## Model Comparison

| Feature               | Workflow AI      | Groq API            |
| --------------------- | ---------------- | ------------------- |
| Speed                 | ⚡⚡⚡ Instant   | ⚡⚡ ~1-2s          |
| Setup Required        | ❌ No            | ✅ Yes (API key)    |
| Element Generation    | ✅ Excellent     | ✅ Good             |
| Background Detection  | ✅ Smart         | ⚠️ Basic            |
| Conversational        | ⚠️ Basic         | ✅ Excellent        |
| Reasoning             | ⚠️ Deterministic | ✅ Advanced         |
| Rate Limits           | ❌ None          | ✅ Yes (generous)   |
| Cost                  | Free             | Free tier available |
| Unsplash Integration  | ✅ Built-in      | ❌ Manual           |
| Creative Descriptions | ✅ Smart parsing | ✅ Natural language |

---

## Automatic Fallback

If you switch to Groq but the API key isn't set or fails:

- ✅ System automatically falls back to Workflow AI
- ✅ Notification shows in chat
- ✅ Request completes successfully
- ✅ No errors or interruptions

```
User tries Groq without API key
→ System detects error
→ Switches to Workflow AI
→ Chat message: "External model error. Using Workflow AI instead."
→ Request processes normally
```

---

## Advanced: Which Model to Use?

### Use **Workflow AI** When:

- ✅ Inserting creative UI elements
- ✅ Setting backgrounds (fast Unsplash lookup)
- ✅ You want instant responses
- ✅ You're on limited network
- ✅ No API keys configured
- ✅ Privacy is important
- ✅ You need deterministic behavior

### Use **Groq API** When:

- ✅ Complex reasoning needed
- ✅ Conversational assistance
- ✅ Natural language understanding
- ✅ More creative suggestions
- ✅ You have API key configured
- ✅ You have time for ~1-2s wait
- ✅ Rate limits are acceptable

---

## Technical Details

### Workflow AI (WorkflowBrain)

**Location:** `/WorkflowBrain.js`

**Key Methods:**

- `analyzeSmartInsertDescription()` - Parse creative descriptions
- `detectInsertIntent()` - Intent detection
- `normalizeInsertCommand()` - Command cleaning
- `analyzeBackgroundRequest()` - Background detection
- `processSmartInsertCommand()` - Main processor

**Flow:**

```
User Input
  ↓
Smart Intent Detection
  ↓
Normalize Command
  ↓
Parse Attributes (color, animation, size, effects)
  ↓
Generate Dynamic HTML/CSS/Animations
  ↓
Insert on Canvas
```

### Groq API (External Model)

**Endpoint:** `/api/ai/groq`

**Model:** `mixtral-8x7b-32768` (Groq's fast inference model)

**Flow:**

```
User Input
  ↓
Send to Groq API
  ↓
Groq processes with LLM
  ↓
Parse response for intent
  ↓
Generate appropriate response
  ↓
Apply to canvas
```

---

## Troubleshooting

### Groq Model Selector Not Showing

- Refresh page (Ctrl+R)
- Check browser console for errors
- Ensure JS loads properly

### Groq API Returns Error

- Verify API key in `.env` is correct
- Check Groq console for usage/limits
- System falls back to Workflow AI automatically

### Workflow AI Seems Slow

- Clear browser cache
- Restart application
- Check if WorkflowBrain.js loaded (browser DevTools)

### Model Switch Doesn't Take Effect

- Complete current request first
- Try new request after switch
- Refresh page if persistent issue

---

## Best Practices

1. **Start with Workflow AI**
   - Fast, responsive, no setup
   - Best for creative element insertion
   - Falls back automatically if issues

2. **Try Groq for Complex Tasks**
   - More advanced reasoning
   - Better at understanding context
   - Useful for architectural decisions

3. **Mix and Match**
   - Use Workflow AI for quick inserts
   - Switch to Groq for strategic planning
   - System remembers your last choice

4. **Monitor Rate Limits**
   - Groq has generous free tier
   - Workflow AI has no limits
   - Auto-fallback protects you

---

## Environment Variables

Required for Groq support:

```env
# Groq API Configuration
GROQ_API_KEY=your_api_key_from_console_groq_com

# Optional: Override default model
# GROQ_MODEL=mixtral-8x7b-32768
```

---

## Future Enhancements

- [ ] Support for Claude (Anthropic)
- [ ] OpenAI model selection
- [ ] Ollama integration (local models)
- [ ] Model performance metrics
- [ ] Custom prompt engineering
- [ ] Temperature/token settings UI
- [ ] Model comparison side-by-side

---

## Questions & Support

- **Workflow AI Issues?** → Check `/WorkflowBrain.js` implementation
- **Groq API Issues?** → Visit https://console.groq.com or https://groq.com/docs
- **General Questions?** → Check project documentation

---

## Summary

You now have **two powerful AI options**:

- 🧠 **Workflow AI** - Instant, creative, no setup
- 🚀 **Groq API** - Advanced reasoning, optional setup

Switch freely between them in chat, and enjoy professional-grade AI assistance! 🎉
