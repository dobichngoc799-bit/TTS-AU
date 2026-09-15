import { useEffect } from 'react'
import { ApiKeyBar } from './components/ApiKeyBar'
import { VoicePanel } from './components/VoicePanel'
import { BatchJobPanel } from './components/BatchJobPanel'
import { JobQueueTable } from './components/JobQueueTable'
import { ActionToolbar } from './components/ActionToolbar'
import { useSettingsStore } from './store/settingsStore'

function App(): React.JSX.Element {
  const init = useSettingsStore((s) => s.init)

  useEffect(() => {
    init()
  }, [init])

  return (
    <div className="flex h-full w-full flex-col bg-gray-100">
      <ApiKeyBar />
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
        <VoicePanel />
        <BatchJobPanel />
        <JobQueueTable />
      </div>
      <ActionToolbar />
    </div>
  )
}

export default App
