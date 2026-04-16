# Workflow AI Command Formatter System - Two-Stage Architecture

## 🎯 System Overview

A professional two-stage AI pipeline that transforms natural language into production-ready builder commands. This enables users to describe UI elements in plain English, and the system automatically formats them into precise, executable builder commands.

### Architecture

```
┌──────────────────────┐
│   User Input         │  "Make a round bouncing red button"
│   (Natural Language) │
└──────────────┬───────┘
               │
        ┌──────▼──────┐
        │  STAGE 1    │
        │  Groq API   │  System Prompt: Command Formatter
        │  (Workflow) │  Input: Raw natural language
        └──────┬──────┘
               │
        ┌──────▼──────────────────────────────┐
        │  GROQ RESPONSE                       │
        │  insert button width:48px;           │
        │         height:48px;                 │
        │         border-radius:50%;           │
        │         background:red;              │
        │         animation:bounce 2s...       │
        └──────┬──────────────────────────────┘
               │
        ┌──────▼──────┐
        │  STAGE 2    │
        │  Parser &   │  Extract & validate commands
        │  Validator  │  Parse into structured format
        └──────┬──────┘
               │
        ┌──────▼──────────────────────┐
        │  BUILDER COMMANDS (OUTPUT)   │
        │  ✅ Validated & parsed       │
        │  ✅ Production-ready         │
        │  ✅ Rendered to canvas       │
        └──────────────────────────────┘
```

## 🔄 Stage 1: User Input Processing

### Endpoint

```
POST /api/workflow/format-command
```

### Request

```json
{
  "input": "Make a round bouncing red button with a shadow"
}
```

### Process

1. User submits raw natural language text
2. Text is sent to Groq API with specialized **Command Formatter System Prompt**
3. Groq AI acts strictly as a command formatter (no explanations, only commands)
4. Returns formatted builder commands

### System Prompt Rules

The Groq AI receives this system prompt to ensure consistent command generation:

```
You are an elite web builder command formatter for a professional AI website builder.

Your task is to convert natural language website requests into strict builder commands ONLY.

CRITICAL RULES:
- Output ONLY valid builder commands.
- NO explanations, markdown, comments, JSON, code blocks, or extra text.
- NO conversational responses.
- Each command on a new line.
```

### Property Intelligence

The system automatically infers and expands properties:

| User Request | Expansion                                                        |
| ------------ | ---------------------------------------------------------------- |
| "round"      | `border-radius:50%;`                                             |
| "shadow"     | `box-shadow:0 8px 24px rgba(0,0,0,0.15);`                        |
| "glass"      | `backdrop-filter:blur(12px); background:rgba(255,255,255,0.15);` |
| "centered"   | `display:flex; justify-content:center; align-items:center;`      |
| "animated"   | `animation:bounce 2s infinite ease-in-out;`                      |
| "gradient"   | `background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);`  |
| "floating"   | `transform:translateY(-4px); box-shadow:...;`                    |

## 🛠️ Stage 2: Command Output Rules

### Exact Syntax Required

```
insert <element_type> <property; property; property; ...>
```

### Command Format Examples

#### Example 1: Round Bouncing Button

```
User Input:
"Make a round bouncing red button"

Groq Output:
insert button width:48px; height:48px; border-radius:50%; background:red; border:none; padding:0; cursor:pointer; animation:bounce 2s infinite ease-in-out; box-shadow:0 4px 12px rgba(0,0,0,0.15);
```

#### Example 2: Hero Section with Gradient

```
User Input:
"Create a centered hero section with gradient background and large text"

Groq Output:
insert section width:100%; min-height:100vh; display:flex; justify-content:center; align-items:center; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:40px;
insert h1 font-size:48px; color:white; text-align:center; margin:0; font-weight:bold;
```

#### Example 3: Glass Card with Shadow

```
User Input:
"Add a glass card with shadow and rounded corners"

Groq Output:
insert div width:320px; padding:24px; border-radius:16px; background:rgba(255,255,255,0.15); backdrop-filter:blur(12px); box-shadow:0 8px 24px rgba(0,0,0,0.1); border:1px solid rgba(255,255,255,0.2);
```

## 📋 Parser Validation

### Stage 2 Processing: Command Validation

The parser validates each command returned by Groq:

```javascript
// Checks:
1. Must start with "insert" keyword
2. Must have element type (button, div, section, etc.)
3. Must have CSS properties (contains : and ;)
4. Must be parser-safe (no special characters, valid syntax)
```

### Validation Results

✅ **Valid Command**: `insert button width:48px; height:48px; border-radius:50%;`
❌ **Invalid**: `Some random text`
❌ **Invalid**: `insert button` (missing properties)

## 🎨 Supported Default Inference

The system automatically adds professional defaults:

### Spacing

- Padding: 16px-24px for containers, 12px for buttons
- Margins: 16px, 24px, 32px increments
- Gaps: 8px, 12px, 16px standard

### Typography

- Base font-size: 16px
- Small text: 14px
- Headings: 24px-48px
- Font-weight: 400 (normal), 600 (semibold), 700 (bold)

### Shadows

- Default: `box-shadow:0 4px 12px rgba(0,0,0,0.1);`
- Light: `box-shadow:0 2px 8px rgba(0,0,0,0.08);`
- Heavy: `box-shadow:0 8px 24px rgba(0,0,0,0.15);`

### Border Radius

- Buttons: 8px
- Cards: 12-16px
- Circles: 50%

### Colors

- Background: #ffffff (white)
- Text: #1f2937 (dark gray)
- Accent: #667eea (professional blue)
- Neutral: #f3f4f6 (light gray)

## 🔌 API Response

### Response Format

```json
{
  "success": true,
  "input": "Make a round bouncing red button",
  "commands": [
    "insert button width:48px; height:48px; border-radius:50%; background:red; animation:bounce 2s infinite ease-in-out; box-shadow:0 4px 12px rgba(0,0,0,0.15);"
  ],
  "parsedCommands": [
    {
      "command": "insert button width:48px; ...",
      "elementType": "button",
      "properties": {
        "width": "48px",
        "height": "48px",
        "border-radius": "50%",
        "background": "red",
        "animation": "bounce 2s infinite ease-in-out",
        "box-shadow": "0 4px 12px rgba(0,0,0,0.15)"
      },
      "isValid": true
    }
  ],
  "commandCount": 1,
  "modelUsed": "llama-3.3-70b-versatile",
  "groqResponse": "insert button width:48px; ...",
  "creditsRemaining": 8
}
```

## 🧠 WorkflowBrain Methods

### 1. getCommandFormatterSystemPrompt()

Returns the system prompt for Groq that ensures command-only output.

```javascript
const prompt = workflowBrain.getCommandFormatterSystemPrompt();
// Use with Groq API
```

### 2. isValidBuilderCommand(command)

Validates if a string is a properly formatted builder command.

```javascript
const isValid = workflowBrain.isValidBuilderCommand(
  "insert button width:48px; height:48px;",
); // true

const invalid = workflowBrain.isValidBuilderCommand("random text"); // false
```

### 3. extractValidCommands(groqResponse)

Filters Groq response to extract only valid commands.

```javascript
const commands = workflowBrain.extractValidCommands(groqResponse);
// Returns: ['insert button ...', 'insert div ...']
```

### 4. parseBuilderCommand(command)

Parses a single command into structured format.

```javascript
const parsed = workflowBrain.parseBuilderCommand(
  'insert button width:48px; height:48px;'
);

// Returns:
{
  command: 'insert button width:48px; height:48px;',
  elementType: 'button',
  properties: {
    width: '48px',
    height: '48px'
  },
  isValid: true
}
```

### 5. parseBuilderCommands(groqResponse)

Batch parse multiple commands from Groq response.

```javascript
const parsed = workflowBrain.parseBuilderCommands(groqResponse);
// Returns: [{ command, elementType, properties, isValid }, ...]
```

### 6. formatCommandsForResponse(commands)

Formats commands for clean API response.

```javascript
const formatted = workflowBrain.formatCommandsForResponse(commands);
// Returns: Clean, whitespace-normalized commands
```

## 📊 Usage Statistics & Examples

### Example 1: Simple Button

```
Input:  "Add a red button"
Output: insert button background:red; padding:12px 24px; border-radius:8px; border:none; cursor:pointer; color:white; font-weight:600;
```

### Example 2: Complex Section

```
Input:  "Create a hero section with centered text and gradient background"
Output: insert section width:100%; min-height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:40px;
```

### Example 3: Vague Request (AI Predicts Intent)

```
Input:  "Make something pretty and clickable"
Output: insert div padding:24px; border-radius:16px; background:rgba(255,255,255,0.15); backdrop-filter:blur(12px); box-shadow:0 8px 24px rgba(0,0,0,0.1); cursor:pointer; transition:all 0.3s ease;
```

## ✅ Quality Assurance

All responses are validated for:

- ✅ Proper syntax compliance
- ✅ CSS property validity
- ✅ Parser safety
- ✅ Production readiness
- ✅ Professional UI standards
- ✅ Cross-browser compatibility

## 🚀 Integration

The formatter can be integrated into:

1. Web builder canvas (renders parsed commands)
2. Code export (generates HTML/CSS)
3. Template system (creates reusable components)
4. Batch processing (multiple commands in sequence)

## 📝 Future Enhancements

- [ ] Nested component support
- [ ] Responsive breakpoint generation
- [ ] Accessibility attribute generation
- [ ] Animation timeline composition
- [ ] Theme-based color inference
- [ ] Accessibility score reporting
- [ ] Performance optimization suggestions
