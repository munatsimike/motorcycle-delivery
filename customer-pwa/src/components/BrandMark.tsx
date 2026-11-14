import riderImage from '../assets/rider-cutout-visible.png';
import { BrandLogo } from './BrandLogo';

export function BrandMark() {
  return (
    <div className="brand-mark">
      <img src={riderImage} alt="" width={129} height={97} />
      <BrandLogo />
    </div>
  );
}
