import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { CrosshairIcon } from '../components/CrosshairIcon';
import riderCutout from '../assets/rider-cutout.png';
import riderMarker from '../assets/rider-motorcycle-marker.png';
import { nearbyHomeCountLabel } from '../home/nearby';
import { useCustomerHome } from '../home/useCustomerHome';

export function HomePage() {
  const [mapNode, setMapNode] = useState<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const cardRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const measure = () => setCardHeight(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const home = useCustomerHome(mapNode, cardHeight, riderMarker);
  const loading = home.availability.status === 'loading';
  const actionable = !loading && home.availability.status !== 'ready';
  const label = nearbyHomeCountLabel(home.availability);
  const dot = home.availability.status === 'ready' && home.availability.count > 0 ? '#23A35D' : '#C9A76A';

  return (
    <main id="main" className="home">
      <div className={home.mapProblem ? 'home-map is-unavailable' : 'home-map'}>
        <div ref={setMapNode} className="home-map-canvas" />
        {home.mapProblem ? <p className="home-map-note">{home.mapProblem}</p> : null}
      </div>
      {home.customer ? (
        <button
          type="button"
          className="home-recenter"
          style={{ bottom: cardHeight + 18 }}
          aria-label="Recenter map"
          onClick={home.recenter}
        >
          <CrosshairIcon />
        </button>
      ) : null}
      <section ref={cardRef} className="home-card" aria-label="Nearby riders">
        <div className="home-card-outline" aria-hidden="true">
          <span className="home-card-corner home-card-corner-left" />
          <span className="home-card-line" />
          <span className="home-card-corner home-card-corner-right" />
        </div>
        <div className="home-intro">
          <div className="home-copy">
            <h1 className="home-title">Nearby riders</h1>
            {loading ? (
              <p className="home-status" role="status">
                <span className="home-spinner" aria-hidden="true" />
                Checking nearby riders
              </p>
            ) : (
              <button
                type="button"
                className="home-status"
                role="status"
                disabled={!actionable}
                aria-label={label}
                onClick={actionable ? home.retry : undefined}
              >
                <span className="home-dot" style={{ backgroundColor: dot }} />
                {label}
              </button>
            )}
            <p className="home-helper">Find a motorcycle courier for your parcel</p>
          </div>
          <img className="home-rider" src={riderCutout} alt="" />
        </div>
        <Link className="home-send" to="/book">
          <SendIcon />
          Send a Parcel
        </Link>
      </section>
    </main>
  );
}

function SendIcon() {
  return (
    <svg className="home-send-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 3v7l15 2L2 14v7l21-9L2 3zm2 3.03 7.5 3.22L4 8.25V6.03zM11.5 14.75 4 17.97v-2.22l7.5-1z" />
    </svg>
  );
}
