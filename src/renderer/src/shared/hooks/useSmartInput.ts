import { useState, useCallback, useRef } from 'react'
import type { Label, Project } from '../../../../shared/types'
import {
  detectOperator,
  removeOperatorText,
  type OperatorType,
  type ActiveOperator
} from './smartInputParser'

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
  popupState: PopupState | null
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
  selectProject: (project: Project) => void
  removeProject: () => void
  dismissPopup: () => void
  removeLastChip: () => void
  reset: () => void
  getSubmitTitle: () => string
}

export type SmartInput = SmartInputState & SmartInputActions

export function useSmartInput(inputRef: React.RefObject<HTMLInputElement | null>): SmartInput {
  const [inputValue, setInputValueRaw] = useState('')
  const [attachedLabels, setAttachedLabels] = useState<Label[]>([])
  const [selectedPriority, setSelectedPriority] = useState<number | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [popupState, setPopupState] = useState<PopupState | null>(null)
  const suppressedPositionsRef = useRef<Set<number>>(new Set())
  const inputValueRef = useRef('')
  const justSelectedRef = useRef(false)

  const updatePopup = useCallback((text: string, cursorPos: number) => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }
    const operator = detectOperator(text, cursorPos, suppressedPositionsRef.current)
    if (!operator) {
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
    setInputValueRaw(value)
    inputValueRef.current = value
    updatePopup(value, cursorPos)
  }, [updatePopup])

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
    setSelectedProject(null)
    setPopupState(null)
    suppressedPositionsRef.current = new Set()
  }, [])

  const getSubmitTitle = useCallback(() => {
    return inputValueRef.current.trim()
  }, [])

  return {
    inputValue,
    attachedLabels,
    selectedPriority,
    selectedDate,
    selectedProject,
    popupState,
    setInputValue,
    handleInputChange,
    handleCursorMove,
    selectLabel,
    removeLabel,
    selectPriority,
    removePriority,
    selectDate,
    removeDate,
    selectProject,
    removeProject,
    dismissPopup,
    removeLastChip,
    reset,
    getSubmitTitle
  }
}
