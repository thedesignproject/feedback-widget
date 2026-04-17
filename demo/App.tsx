import { FeedbackWidget } from 'feedback-widget'

export function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Feedback Widget Demo</h1>
      <p>This is a sample page to test the feedback widget.</p>

      <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h2>Sample Card</h2>
        <p>Click on any element to leave feedback.</p>
        <button style={{ padding: '0.5rem 1rem', background: '#E85D2A', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
          Sample Button
        </button>
      </div>

      <FeedbackWidget projectId="demo-project" apiBase="https://feedback-widget-sigma.vercel.app/api" />
    </div>
  )
}
