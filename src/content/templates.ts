import { localDate } from '../lib/pages'

export const welcomeHtml = () => `
  <p>Everything here is encrypted in your browser before it leaves. The server only stores and forwards scrambled data.</p>
  <h2>Work together</h2>
  <ol>
    <li><p>Choose Share and send the invite link over an end-to-end encrypted chat. The key sits after the #, so the server never sees it.</p></li>
    <li><p>Everyone appears under a random alias. Change it in the sidebar if you like.</p></li>
    <li><p>Type / for headings, lists, tasks, and quotes. Type [[ to link another page.</p></li>
    <li><p>Group pages into sections (New → Section) and drag pages between them in the sidebar.</p></li>
  </ol>
  <h2>First tasks</h2>
  <p>Tasks mix freely with text. Use ⚑ on a task for priority and a due date; Tab makes a subtask. Every task shows up in Tasks in the sidebar.</p>
  <ul data-type="taskList">
    <li data-type="taskItem" data-checked="false" data-priority="high" data-due="${localDate()}"><p>Invite a teammate</p></li>
    <li data-type="taskItem" data-checked="false" data-due="${localDate(2)}"><p>Capture the project in a page</p>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>Add a section for each area of work</p></li>
        <li data-type="taskItem" data-checked="false"><p>Sketch the plan on a board</p></li>
      </ul>
    </li>
  </ul>
`

export const TASKS_HTML = `
  <h2>Now</h2>
  <ul data-type="taskList">
    <li data-type="taskItem" data-checked="false" data-priority="high"><p></p></li>
  </ul>
  <h2>Next</h2>
  <ul data-type="taskList">
    <li data-type="taskItem" data-checked="false"><p></p></li>
  </ul>
  <h2>Ideas for later</h2>
  <ul><li><p></p></li></ul>
`

export const MEETING_HTML = `
  <p>Date, time, and who is here.</p>
  <h2>Agenda</h2>
  <ul><li><p></p></li></ul>
  <h2>Notes</h2>
  <p></p>
  <h2>Actions</h2>
  <ul data-type="taskList">
    <li data-type="taskItem" data-checked="false"><p></p></li>
  </ul>
`

export const DECISION_HTML = `
  <h2>Decision</h2>
  <p></p>
  <h2>Context</h2>
  <p></p>
  <h2>Options</h2>
  <ul><li><p></p></li><li><p></p></li></ul>
  <h2>Outcome</h2>
  <p></p>
`
