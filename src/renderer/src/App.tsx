import { useEffect } from 'react'
import { ApiKeyBar } from './components/ApiKeyBar'
import { VoicePanel } from './components/VoicePanel'
import { BatchJobPanel } from './components/BatchJobPanel'
import { JobQueueTable } from './components/JobQueueTable'
import { ActionToolbar } from './components/ActionToolbar'
import { useSettingsStore } from './store/settingsStore'
import { useJobStore } from './store/jobStore'

function App(): React.JSX.Element {
  const init = useSettingsStore((s) => s.init)
  const loadSavedJob = useJobStore((s) => s.loadSavedJob)

  useEffect(() => {
    init()
    loadSavedJob()
  }, [init, loadSavedJob])

  return (
    <div className="flex h-full w-full flex-col bg-[#eef0f4]">
      <ApiKeyBar />
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        <VoicePanel />
        <BatchJobPanel />
        <JobQueueTable />
      </div>
      <ActionToolbar />
    </div>
  )
}

export default App
