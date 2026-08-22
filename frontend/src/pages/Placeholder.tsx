interface Props {
  title: string;
  icon: string;
}

export function Placeholder({ title, icon }: Props) {
  return (
    <div className="flex items-center justify-center h-96">
      <div className="text-center">
        <div className="text-6xl mb-4">{icon}</div>
        <h2 className="text-2xl font-bold text-white mb-2">{title}</h2>
        <p className="text-gray-500 text-sm max-w-xs">
          This section will be available once the business logic phase is implemented.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400">
          <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
          Coming in next phase
        </div>
      </div>
    </div>
  );
}
