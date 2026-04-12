import { useState, useCallback, useRef } from 'react'
import type { Label, Project } from '../../../../shared/types'
import {
  detectOperator,
  removeOperatorText,
  type OperatorType,
  type ActiveOperator
} from './smartInputParser'
import { parseNlpDate, stripDateFromTitle, formatNlpDate, type NlpDateResult } from '../../../../shared/nlpDateParser'

export interface PopupState {
  type: OperatorType
  query: string
  position: { top: number; left: number }
  operator: ActiveOperator
}

export interface SmartInputState {
  inputValue: string
  attachedLabels: Label[]
  selectedPriority: number | null
  selectedDate: string | null
  selectedProject: Project | null
  referenceUrl: string | null
  popupState: PopupState | null
  nlpDateResult: NlpDateResult | null
}

export interface SmartInputActions {
  setInputValue: (value: string) => void
  handleInputChange: (value: string, cursorPos: number) => void
  handleCursorMove: (cursorPos: number) => void
  selectLabel: (label: Label) => void
  removeLabel: (labelId: string) => void
  selectPriority: (value: number) => void
  removePriority: () => void
  selectDate: (isoDate: string) => void
  removeDate: () => void
  selectReferenceUrl: (url: string) => void
  removeReferenceUrl: () => void
  selectProject: (project: Project) => void
  removeProject: () => void
  dismissPopup: () => void
  dismissNlpDate: () => void
  removeLastChip: () => void
  reset: () => void
  getSubmitData: () => { title: string; extractedReferenceUrl: string | null; nlpDate: string | null; nlpRecurrenceRule: string | null }
}

export type SmartInput = SmartInputState & SmartInputActions

export function useSmartInput(inputRef: React.RefObject<HTMLInputElement | null>): SmartInput {
  const [inputValue, setInputValueRaw] = useState('')
  const [attachedLabels, setAttachedLabels] = useState<Label[]>([])
  const [selectedPriority, setSelectedPriority] = useState<number | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [popupState, setPopupState] = useState<PopupState | null>(null)
  const [nlpDateResult, setNlpDateResult] = useState<NlpDateResult | null>(null)
  const nlpDismissedRef = useRef(false)
  const suppressedPositionsRef = useRef<Set<number>>(new Set())
  const inputValueRef = useRef('')
  const justSelectedRef = useRef(false)

  const updatePopup = useCallback((text: string, cursorPos: number) => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }
    const operator = detectOperator(text, cursorPos, suppressedPositionsRef.current)
    if (!operator || operator.type === 'r:') {
      setPopupState(null)
      return
    }

    const el = inputRef.current
    if (!el) {
      setPopupState(null)
      return
    }

    const rect = el.getBoundingClientRect()
    // Approximate the x position of the operator
    const charWidth = 8 // approximate
    const offsetX = Math.min(operator.startIndex * charWidth, rect.width - 40)

    setPopupState({
      type: operator.type,
      query: operator.query,
      position: { top: rect.bottom + 4, left: rect.left + offsetX },
      operator
    })
  }, [inputRef])

  const setInputValue = useCallback((value: string) => {
    setInputValueRaw(value)
    inputValueRef.current = value
  }, [])

  const handleInputChange = useCallback((value: string, cursorPos: number) => {
    // Auto-capture r: operator on space — no popup needed
    const rOp = detectOperator(value.slice(0, cursorPos - 1), cursorPos - 1, suppressedPositionsRef.current)
    if (rOp && rOp.type === 'r:' && rOp.query.length > 0 && value[cursorPos - 1] === ' ') {
      setReferenceUrl(rOp.query)
      const cleaned = removeOperatorText(value, rOp.startIndex, cursorPos)
      setInputValueRaw(cleaned)
      inputValueRef.current = cleaned
      suppressedPositionsRef.current = new Set()
      setPopupState(null)
      return
    }
    setInputValueRaw(value)
    inputValueRef.current = value
    updatePopup(value, cursorPos)

    // Always-on NLP detection: only when no explicit d: operator and no date already selected
    if (!selectedDate && !value.includes('d:') && !nlpDismissedRef.current) {
      const nlp = parseNlpDate(value)
      // Avoid false positives: skip if detected text is >= 80% of input length
      if (nlp && nlp.text.length < value.trim().length * 0.8) {
        setNlpDateResult(nlp)
      } else {
        setNlpDateResult(null)
      }
    } else if (!selectedDate && !value.includes('d:')) {
      // NLP dismissed but text changed — re-check on significant changes
    } else {
      setNlpDateResult(null)
    }
  }, [updatePopup, selectedDate])

  const handleCursorMove = useCallback((cursorPos: number) => {
    updatePopup(inputValueRef.current, cursorPos)
  }, [updatePopup])

  const selectLabel = useCallback((label: Label) => {
    if (!popupState?.operator) return
    justSelectedRef.current = true
    setAttachedLabels((prev) => {
      if (prev.some((l) => l.id === label.id)) return prev
      return [...prev, label]
    })
    const newValue = removeOperatorText(
      inputValueRef.current,
      popupState.operator.startIndex,
      popupState.operator.endIndex
    )
    setInputValueRaw(newValue)
    inputValueRef.current = newValue
    setPopupState(null)
    suppressedPositionsRef.current = new Set()
  }, [popupState])

  const removeLabel = useCallback((labelId: string) => {
    setAttachedLabels((prev) => prev.filter((l) => l.id !== labelId))
  }, [])

  const selectPriority = useCallback((value: number) => {
    if (!popupState?.operator) return
    justSelectedRef.current = true
    setSelectedPriority(value)
    const newValue = removeOperatorText(
      inputValueRef.current,
      popupState.operator.startIndex,
      popupState.operator.endIndex
    )
    setInputValueRaw(newValue)
    inputValueRef.current = newValue
    setPopupState(null)
    suppressedPositionsRef.current = new Set()
  }, [popupState])

  const removePriority = useCallback(() => {
    setSelectedPriority(null)
  }, [])

  const selectDate = useCallback((isoDate: string) => {
    if (!popupState?.operator) return
    justSelectedRef.current = true
    setSelectedDate(isoDate)
    const newValue = removeOperatorText(
      inputValueRef.current,
      popupState.operator.startIndex,
      popupState.operator.endIndex
    )
    setInputValueRaw(newValue)
    inputValueRef.current = newValue
    setPopupState(null)
    suppressedPositionsRef.current = new Set()
  }, [popupState])

  const removeDate = useCallback(() => {
    setSelectedDate(null)
  }, [])

  const selectReferenceUrl = useCallback((url: string) => {
    if (!popupState?.operator) return
    justSelectedRef.current = true
    setReferenceUrl(url)
    const newValue = removeOperatorText(
      inputValueRef.current,
      popupState.operator.startIndex,
      popupState.operator.endIndex
    )
    setInputValueRaw(newValue)
    inputValueRef.current = newValue
    setPopupState(null)
    suppressedPositionsRef.current = new Set()
  }, [popupState])

  const removeReferenceUrl = useCallback(() => {
    setReferenceUrl(null)
  }, [])

  const selectProject = useCallback((project: Project) => {
    if (!popupState?.operator) return
    justSelectedRef.current = true
    setSelectedProject(project)
    const newValue = removeOperatorText(
      inputValueRef.current,
      popupState.operator.startIndex,
      popupState.operator.endIndex
    )
    setInputValueRaw(newValue)
    inputValueRef.current = newValue
    setPopupState(null)
    suppressedPositionsRef.current = new Set()
  }, [popupState])

  const removeProject = useCallback(() => {
    setSelectedProject(null)
  }, [])

  const dismissPopup = useCallback(() => {
    if (popupState?.operator) {
      suppressedPositionsRef.current = new Set([
        ...suppressedPositionsRef.current,
        popupState.operator.startIndex
      ])
    }
    setPopupState(null)
  }, [popupState])

  const dismissNlpDate = useCallback(() => {
    setNlpDateResult(null)
    nlpDismissedRef.current = true
  }, [])

  const removeLastChip = useCallback(() => {
    // Remove last label, then priority, then date
    setAttachedLabels((prev) => {
      if (prev.length > 0) return prev.slice(0, -1)
      return prev
    })
  }, [])

  const reset = useCallback(() => {
    setInputValueRaw('')
    inputValueRef.current = ''
    setAttachedLabels([])
    setSelectedPriority(null)
    setSelectedDate(null)
    setReferenceUrl(null)
    setSelectedProject(null)
    setPopupState(null)
    setNlpDateResult(null)
    nlpDismissedRef.current = false
    suppressedPositionsRef.current = new Set()
  }, [])

  const getSubmitData = useCallback(() => {
    const text = inputValueRef.current
    // Extract any pending r: operator before submit
    const rMatch = text.match(/(^|\s)r:(\S+)/)
    let title: string
    let extractedReferenceUrl: string | null = null
    if (rMatch && rMatch[2]) {
      const cleaned = text.slice(0, rMatch.index! + (rMatch[1] ? 1 : 0)) + text.slice(rMatch.index! + rMatch[0].length)
      title = cleaned.replace(/  +/g, ' ').trim()
      extractedReferenceUrl = rMatch[2]
    } else {
      title = text.trim()
    }

    // Apply NLP date stripping if NLP detected and no explicit date
    // Re-parse at submit time to get the most accurate result (state may lag behind typing)
    let nlpDate: string | null = null
    let nlpRecurrenceRule: string | null = null
    const freshNlp = (!selectedDate && !title.includes('d:')) ? parseNlpDate(title) : null
    const effectiveNlp = freshNlp ?? nlpDateResult
    console.log('[SmartInput] getSubmitData:', { title, selectedDate, freshNlpText: freshNlp?.text, freshNlpRule: freshNlp?.recurrenceRule, stateNlpText: nlpDateResult?.text, effectiveText: effectiveNlp?.text, effectiveRule: effectiveNlp?.recurrenceRule })
    if (effectiveNlp && !selectedDate) {
      title = stripDateFromTitle(title, effectiveNlp)
      nlpDate = formatNlpDate(effectiveNlp)
      nlpRecurrenceRule = effectiveNlp.recurrenceRule

      // Empty title after stripping = use "Untitled"
      if (!title) title = 'Untitled'
    }

    console.log('[SmartInput] submit result:', { title, nlpDate, nlpRecurrenceRule })
    return { title, extractedReferenceUrl, nlpDate, nlpRecurrenceRule }
  }, [nlpDateResult, selectedDate])

  return {
    inputValue,
    attachedLabels,
    selectedPriority,
    selectedDate,
    selectedProject,
    referenceUrl,
    popupState,
    nlpDateResult,
    setInputValue,
    handleInputChange,
    handleCursorMove,
    selectLabel,
    removeLabel,
    selectPriority,
    removePriority,
    selectDate,
    removeDate,
    selectReferenceUrl,
    removeReferenceUrl,
    selectProject,
    removeProject,
    dismissPopup,
    dismissNlpDate,
    removeLastChip,
    reset,
    getSubmitData
  }
}
