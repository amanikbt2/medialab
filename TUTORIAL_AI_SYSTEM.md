# MediaLab Workflow AI Tutorial System

## Overview
The Workflow AI Tutorial system automatically detects when users are asking for tutorials or learning-focused guidance and activates specialized tutorial mode. This provides patient, step-by-step guidance across different MediaLab features.

## How It Works

### 1. **Tutorial Intent Detection**
The system detects tutorial keywords:
- **Strong patterns (95% confidence)**:
  - "teach me", "show me", "demonstrate", "guide me"
  - "how do/can I use/work with X"
  - "tutorial for X"

- **Medium patterns (80% confidence)**:
  - "help with", "explain how", "step by step"
  - "how does X work"

- **Weak patterns (75% confidence)**:
  - General learning keywords + topic keywords

### 2. **Learning Topic Recognition**
The system identifies what the user wants to learn:
- Element creation
- Animations
- Publishing
- Hosting/Deployment
- Monetization (AdSense)
- Marketplace
- Withdrawals
- Collaboration
- Builder basics

### 3. **Specialized System Prompts**
When tutorial mode is detected, the AI switches to a topic-specific system prompt:
- **Element Creation Guide**: Patient explanation of element properties, animations, colors
- **Animation Expert**: Explains motion effects, timing, combinations
- **Publishing Coach**: Step-by-step GitHub + Render workflow
- **Hosting Expert**: Clear guidance on deployment and live URLs
- **Monetization Advisor**: AdSense approval and earning mechanics
- **Marketplace Guide**: Listing projects and selling templates
- **Payments Specialist**: Withdrawal process and payment methods
- **Collaboration Guide**: Live co-editing and team features
- **Builder Basics Tutor**: Canvas fundamentals and design essentials

### 4. **Response Metadata**
API responses include tutorial mode information:
```json
{
  "success": true,
  "assistantReply": "...",
  "tutorialMode": {
    "enabled": true,
    "topic": "element-creation",
    "topicLabel": "creating elements",
    "confidence": 0.95,
    "type": "strong",
    "details": {
      "isAskingForSteps": true,
      "isAskingForExplanation": false,
      "isAskingForBestPractices": false,
      "isAskingForTroubleshooting": false
    },
    "message": "📚 Tutorial Mode Active - Learning-focused guidance enabled"
  }
}
```

## Example Uses

### User Inputs That Trigger Tutorial Mode

✅ **Element Creation:**
- "teach me how to insert a button"
- "show me how to create a red circle"
- "how do I add animated elements to my page?"

✅ **Animations:**
- "how do I create a bouncing animation?"
- "explain the glow effect and how to use it"
- "how do animations work in medialab?"

✅ **Publishing:**
- "show me step by step how to publish my project"
- "teach me the github publishing workflow"
- "explain how to push to github with medialab"

✅ **Hosting:**
- "how do I deploy to render?"
- "teach me how to make my project live online"
- "guide me through the hosting setup"

✅ **Monetization:**
- "how do I monetize my projects?"
- "teach me about adsense integration"
- "explain how to earn money from my sites"

✅ **Marketplace:**
- "show me how to sell projects"
- "teach me how to list in the marketplace"
- "how do I create marketplace templates?"

✅ **Withdrawals:**
- "how do I withdraw my earnings?"
- "teach me about payments in medialab"
- "guide me through the withdrawal process"

### Inputs That Don't Trigger Tutorial Mode

❌ "Can you add a button to my code?"
❌ "Fix this CSS error"
❌ "What's the capital of France?"
❌ "Make this button blue"

## Technical Details

### WorkflowBrain Methods

#### `detectTutorialIntent(userInput)`
Returns tutorial intent analysis with confidence score.

```javascript
{
  isIntent: true,
  confidence: 0.95,  // 0.95, 0.80, 0.75, or 0
  type: "strong"     // 'strong', 'medium', 'probable', 'none'
}
```

#### `parseTutorialRequest(userInput)`
Returns detailed tutorial request analysis.

```javascript
{
  isTutorialRequest: true,
  tutorialConfidence: 0.95,
  tutorialType: "strong",
  learningTopic: "element-creation",  // or "animations", "publishing", etc
  topicLabel: "creating elements",
  requestDetails: {
    isAskingForSteps: true,
    isAskingForExplanation: false,
    isAskingForBestPractices: false,
    isAskingForTroubleshooting: false
  }
}
```

#### `buildTutorialSystemPrompt(topic)`
Returns a specialized system prompt for the given learning topic.

### API Integration

The `/api/ai/chat-edit` endpoint now:
1. Detects tutorial intent from user prompt
2. Routes to topic-specific system prompt if tutorial detected
3. Returns `tutorialMode` metadata in response
4. AI provides patient, step-by-step guidance

## Future Enhancements

Potential improvements:
- Interactive tutorials with live examples
- Video links for visual learners
- Estimated time to complete each tutorial
- Progress tracking for multi-step tutorials
- Tutorial difficulty levels (beginner/intermediate/advanced)
- Community-contributed tutorial snippets
- Tutorial completion badges/certificates
- Personalized learning paths based on user goals

## Testing

Run the tutorial detection tests:
```bash
node test-tutorial-detection.mjs
```

This validates:
- Intent detection patterns
- Topic recognition accuracy
- System prompt generation
- Confidence scoring
