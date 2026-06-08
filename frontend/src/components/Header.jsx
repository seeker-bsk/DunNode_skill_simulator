import { useTheme } from '../contexts/ThemeContext';

export default function Header() {
  const { theme, toggle } = useTheme();
  return (
    <header className="header">
      <span className="header-title">DNF 스킬 시뮬레이터</span>
      <button
        className="theme-toggle"
        onClick={toggle}
        title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      >
        {theme === 'dark' ? '☀' : '🌙'}
      </button>
    </header>
  );
}
