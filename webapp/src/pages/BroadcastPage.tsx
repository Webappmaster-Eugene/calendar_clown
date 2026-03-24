export function BroadcastPage() {
  return (
    <div className="page">
      <h1 className="page-title">Рассылка</h1>

      <div className="empty-state">
        <div className="empty-state-emoji">📢</div>
        <div className="empty-state-text">
          Рассылка доступна только через бота в Telegram.
        </div>
        <div className="card" style={{ width: "100%" }}>
          <div className="card-title">Команда для рассылки</div>
          <div className="card-hint">
            Используйте команду <strong>/broadcast</strong> в боте
          </div>
        </div>
      </div>
    </div>
  );
}
