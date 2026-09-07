import type { TextRangeAnchor } from '../../lib/textAnchor'
import type { ScreenshotFocusRect } from '../../lib/screenshotCapture'

export interface FeedbackWidgetProps {
  projectId: string
  apiBase?: string
  /** Visual theme. `system` follows the browser's preferred color scheme. */
  theme?: 'light' | 'dark' | 'system'
  /** When true, the widget renders nothing and registers no listeners. */
  disabled?: boolean
  /** Private, account-owned comments supplied by the browser extension. */
  personalComments?: PersonalComments
  /** Signed-in extension identity; never taken from the visited website. */
  viewerEmail?: string
  /** Page interaction supplied by an isolated browser-extension frame. */
  page?: WidgetPage
}

export interface WidgetPage {
  url: string
  width: number
  height: number
  scrollX: number
  scrollY: number
  target?: ClickTarget
  liveIds: string[]
  capture(focus: ScreenshotFocusRect | null): Promise<Blob | null>
  selecting(value: boolean): void
  track(comments: { id: string; selector: string }[]): void
  highlight(selector: string): void
  /** Hide the browser-extension surface for the current tab. */
  hide?(): void
}

export interface PersonalComments {
  /** Return false when the extension opens sign-in instead of the launcher. */
  beforeOpen?(): Promise<boolean>
  list(pageUrl: string): Promise<Comment[]>
  create(payload: Record<string, unknown>): Promise<Comment>
  update(id: string, body: string): Promise<unknown>
  remove(id: string): Promise<void>
}

export type Mode = 'idle' | 'selecting' | 'commenting'
export type ReviewStatus = 'open' | 'accepted' | 'rejected'
export type CommentTargetType = 'element_point' | 'text_range'

export interface ClickTarget {
  selector: string
  x: number
  y: number
  url: string
  targetType?: CommentTargetType
  anchor?: TextRangeAnchor
}

export interface Comment {
  id: string
  projectId: string
  pageUrl: string
  x: number
  y: number
  selector: string
  body: string
  reviewStatus: ReviewStatus
  imageUrl?: string | null
  createdAt: string
  authorName?: string
  targetType?: CommentTargetType
  anchor?: TextRangeAnchor | null
}
