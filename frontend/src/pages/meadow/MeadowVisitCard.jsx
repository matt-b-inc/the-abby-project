import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MEADOW_COMPANION, MEADOW_TOKENS } from './meadow.constants';
import './meadow.css';

export default function MeadowVisitCard() {
  return (
    <Link to="/meadow" className="meadow-visit" style={MEADOW_TOKENS}>
      <img src={MEADOW_COMPANION.portrait} alt="" width="88" height="88" />
      <span className="meadow-visit-copy">
        <span className="meadow-eyebrow">A little place to grow</span>
        <span className="meadow-visit-title">Visit your meadow</span>
        <span>Keep a memory. Spend a moment with your dragon.</span>
      </span>
      <ArrowRight size={22} aria-hidden="true" />
    </Link>
  );
}
