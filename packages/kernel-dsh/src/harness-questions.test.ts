import { describe, expect, it } from 'vitest'

import type { ChatQuestion } from '@vulonlok/shared'

import { answerValue, questionsOf } from './harness-questions.js'

describe('questionsOf', () => {
  it('reads the questions the runtime sent', () => {
    const request = {
      questions: [
        {
          id: 'q1',
          question: '用哪个？',
          header: '选择',
          options: [{ label: 'A', description: '第一个' }, { label: 'B' }],
          multiSelect: true,
        },
      ],
    }

    expect(questionsOf(request)).toEqual([
      {
        id: 'q1',
        question: '用哪个？',
        header: '选择',
        options: [{ label: 'A', description: '第一个' }, { label: 'B' }],
        multiSelect: true,
      },
    ])
  })

  it('drops entries with no identity or no question text', () => {
    const request = { questions: [{ id: '', question: 'x' }, { id: 'q', question: '' }, 'nope'] }

    expect(questionsOf(request)).toEqual([])
  })

  it('answers a payload it cannot read with an empty list', () => {
    // An unreadable request must not throw: the tool call is already waiting, and
    // hanging it is worse than failing it.
    expect(questionsOf(null)).toEqual([])
    expect(questionsOf({})).toEqual([])
    expect(questionsOf({ questions: 'nope' })).toEqual([])
  })

  it('keeps a question without options as free text', () => {
    expect(questionsOf({ questions: [{ id: 'q', question: '叫什么？' }] })).toEqual([
      { id: 'q', question: '叫什么？' },
    ])
  })
})

describe('answerValue', () => {
  const questions: ChatQuestion[] = [
    { id: 'a', question: '甲', options: [{ label: 'x' }, { label: 'y' }] },
    { id: 'b', question: '乙' },
  ]

  it('keeps the selections and the typed answer', () => {
    expect(answerValue(questions, [{ id: 'a', selected: ['x'], custom: '补充' }])).toEqual({
      answers: [
        { id: 'a', selected: ['x'], custom: '补充' },
        { id: 'b', selected: [] },
      ],
    })
  })

  it('fills in every question the runtime asked', () => {
    // The runtime refuses a batch that misses one of its questions, so an
    // unanswered question still has to appear.
    expect(answerValue(questions, []).answers.map((answer) => answer.id)).toEqual(['a', 'b'])
  })

  it('drops a selection the model never offered', () => {
    expect(answerValue(questions, [{ id: 'a', selected: ['zzz'] }]).answers[0]?.selected).toEqual(
      [],
    )
  })

  it('ignores a blank custom answer', () => {
    expect(answerValue(questions, [{ id: 'b', selected: [], custom: '   ' }]).answers[1]).toEqual({
      id: 'b',
      selected: [],
    })
  })
})
