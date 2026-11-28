import brandR from '../assets/riders-brand-r.webp';

export function BrandLogo() {
  return (
    <span className="brand-logo" role="img" aria-label="Riders Delivery">
      <img className="brand-r" src={brandR} alt="" width={60} height={48} aria-hidden="true" />
      <span aria-hidden="true">
        <span className="name">iders</span>
        <span className="caption">DELIVERY</span>
      </span>
    </span>
  );
}
