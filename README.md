# @tosses/feedback-widget

Visual feedback tool for React projects. Your client visits their deployed URL, clicks any element, and leaves a comment. You see everything instantly.

## Installation

```bash
npm install @tosses/feedback-widget
```

## Usage

```jsx
import { FeedbackWidget } from '@tosses/feedback-widget'

export default function App() {
  return (
    <>
      {/* your app */}
      <FeedbackWidget projectId="your-project-name" />
    </>
  )
}
```

## Requirements

- React 18+
- A Supabase project with a comments table
