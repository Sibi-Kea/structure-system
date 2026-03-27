import Image from "next/image";

export default function AppLoading() {
  return (
    <main className="app-loader" role="status" aria-live="polite" aria-label="Loading CRC Reporting">
      <div className="app-loader__blur" />
      <div className="app-loader__glow app-loader__glow--primary" />
      <div className="app-loader__glow app-loader__glow--secondary" />
      <div className="app-loader__content">
        <div className="app-loader__logo-shell">
          <Image
            src="/icons/crc-logo.svg"
            alt="CRC logo"
            width={108}
            height={108}
            priority
            className="app-loader__logo"
          />
        </div>
        <p className="app-loader__title">CRC Reporting</p>
        <p className="app-loader__subtitle">Opening secure workspace...</p>
      </div>
    </main>
  );
}

