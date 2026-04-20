import {
  motion,
  type MotionValue,
  useMotionTemplate,
  useSpring,
} from 'framer-motion'
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react'

// ---- Context ----

type VtooltipContextValue = {
  IconRefs: React.MutableRefObject<HTMLButtonElement[]>
  ToolTipRef: React.MutableRefObject<HTMLDivElement[]>
  ToolTipParentRef: React.MutableRefObject<HTMLDivElement | null>
  tooltipPosition: MotionValue<number>
  clipPathTop: MotionValue<number>
  clipPathBottom: MotionValue<number>
  opacity: MotionValue<number>
  onMouseEnterOnIcon: (e: React.MouseEvent<HTMLButtonElement>, index: number) => void
  onMouseLeave: () => void
  setIconRef: (index: number, el: HTMLButtonElement | null) => void
  setTooltipRef: (index: number, el: HTMLDivElement | null) => void
  registerContent: (index: number, content: React.ReactNode) => void
  itemsCountRef: React.MutableRefObject<number>
}

const VtooltipContext = createContext<VtooltipContextValue | null>(null)

function useVtooltipContext() {
  const ctx = useContext(VtooltipContext)
  if (!ctx) throw new Error('Vtooltip components must be used within VtooltipRoot')
  return ctx
}

// ---- Root ----

export function VtooltipRoot({
  children,
  springConfig = { type: 'spring' as const, stiffness: 400, damping: 30, mass: 0.8 },
}: {
  children: React.ReactNode
  springConfig?: any
}) {
  const IconRefs = useRef<HTMLButtonElement[]>([])
  const ToolTipRef = useRef<HTMLDivElement[]>([])
  const ToolTipParentRef = useRef<HTMLDivElement>(null)
  const itemsCountRef = useRef(0)
  const contentMapRef = useRef<Map<number, React.ReactNode>>(new Map())
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)

  const tooltipPosition = useSpring(0, { stiffness: 350, damping: 30 })
  const clipPathTop = useSpring(0, springConfig)
  const clipPathBottom = useSpring(79, springConfig)
  const opacity = useSpring(0, { stiffness: 300, damping: 30, mass: 0.8 })

  const calculateClipPath = (index: number | null) => {
    if (index === null) {
      clipPathTop.set(0)
      clipPathBottom.set(0)
      opacity.set(0)
      return
    }

    let topHeight = 0
    for (let i = 0; i < index; i++) {
      topHeight += ToolTipRef.current[i]?.getBoundingClientRect().height || 0
    }

    let bottomHeight = 0
    for (let i = index + 1; i < itemsCountRef.current; i++) {
      bottomHeight += ToolTipRef.current[i]?.getBoundingClientRect().height || 0
    }

    const totalHeight = ToolTipRef.current.reduce(
      (sum, el) => sum + (el?.getBoundingClientRect().height || 0),
      0,
    )

    clipPathTop.set(totalHeight > 0 ? (topHeight / totalHeight) * 100 : 20)
    clipPathBottom.set(totalHeight > 0 ? (bottomHeight / totalHeight) * 100 : 20)
    opacity.set(1)
  }

  const onMouseEnterOnIcon = (e: React.MouseEvent<HTMLButtonElement>, index: number) => {
    const activeIcon = IconRefs.current[index]?.getBoundingClientRect()
    const activeTooltip = ToolTipRef.current[index]?.getBoundingClientRect()
    const parentTooltip = ToolTipParentRef.current?.getBoundingClientRect()

    if (activeIcon && parentTooltip && activeTooltip) {
      let heightBefore = 0
      for (let i = 0; i < index; i++) {
        heightBefore += ToolTipRef.current[i]?.getBoundingClientRect().height || 0
      }
      const centerY = activeIcon.top + activeIcon.height / 2
      const activePos = (parentTooltip.top || 0) + heightBefore + activeTooltip.height / 2
      tooltipPosition.set(centerY - activePos)
    }

    calculateClipPath(index)
  }

  const onMouseLeave = () => {
    opacity.set(0)
  }

  const setIconRef = (index: number, el: HTMLButtonElement | null) => {
    if (el) IconRefs.current[index] = el
  }

  const setTooltipRef = (index: number, el: HTMLDivElement | null) => {
    if (el) ToolTipRef.current[index] = el
  }

  const registerContent = useCallback((index: number, content: React.ReactNode) => {
    const prev = contentMapRef.current.get(index)
    if (prev !== content) {
      contentMapRef.current.set(index, content)
      itemsCountRef.current = contentMapRef.current.size
      forceUpdate()
    }
  }, [])

  const contentItems = Array.from(contentMapRef.current.entries()).sort(([a], [b]) => a - b)

  const clipPath = useMotionTemplate`inset(${clipPathTop}% 0 ${clipPathBottom}% 0 round 10px )`

  return (
    <VtooltipContext.Provider
      value={{
        IconRefs,
        ToolTipRef,
        ToolTipParentRef,
        tooltipPosition,
        clipPathTop,
        clipPathBottom,
        opacity,
        onMouseEnterOnIcon,
        onMouseLeave,
        setIconRef,
        setTooltipRef,
        registerContent,
        itemsCountRef,
      }}
    >
      <div style={{ position: 'relative', color: '#fff' }}>
        {/* Tooltip container — positioned to the left */}
        <div
          ref={ToolTipParentRef}
          style={{ position: 'absolute', right: 52, top: 0 }}
        >
          <motion.div
            style={{
              opacity,
              y: tooltipPosition,
              clipPath,
              background: '#000',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {contentItems.map(([idx, content]) => (
              <div
                ref={(el) => setTooltipRef(idx, el)}
                key={idx}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 32,
                }}
              >
                {content}
              </div>
            ))}
          </motion.div>
        </div>
        {children}
      </div>
    </VtooltipContext.Provider>
  )
}

// ---- Item ----

export function VtooltipItem({
  children,
  index,
}: {
  children: React.ReactNode
  index: number
}) {
  const { registerContent } = useVtooltipContext()
  const prevRef = useRef<React.ReactNode>(null)

  useEffect(() => {
    let content: React.ReactNode = null
    React.Children.forEach(React.Children.toArray(children), (child) => {
      if (React.isValidElement(child) && child.type === VtooltipContent) {
        content = (child.props as { children: React.ReactNode }).children
      }
    })
    if (content && prevRef.current !== content) {
      prevRef.current = content
      registerContent(index, content)
    }
  }, [children, index, registerContent])

  return (
    <div>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child) && child.type === VtooltipTrigger) {
          return (
            <VtooltipTriggerWrapper index={index} onClick={(child.props as any).onClick}>
              {(child.props as { children: React.ReactNode }).children}
            </VtooltipTriggerWrapper>
          )
        }
        return null
      })}
    </div>
  )
}

// ---- Trigger wrapper (internal) ----

function VtooltipTriggerWrapper({
  children,
  index,
  onClick,
}: {
  children: React.ReactNode
  index: number
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const { onMouseEnterOnIcon, onMouseLeave, setIconRef } = useVtooltipContext()

  return (
    <button
      ref={(el) => setIconRef(index, el)}
      onMouseEnter={(e) => onMouseEnterOnIcon(e, index)}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'inherit',
        padding: 0,
      }}
    >
      {children}
    </button>
  )
}

// ---- Trigger / Content (marker components) ----

export function VtooltipTrigger({
  children,
  onClick,
}: {
  children: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return <>{children}</>
}

export function VtooltipContent({ children }: { children: React.ReactNode; className?: string }) {
  return <>{children}</>
}
