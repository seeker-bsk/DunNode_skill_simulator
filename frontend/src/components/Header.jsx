import { useTheme } from '../contexts/ThemeContext';
import { PiSunDimFill, PiMoonStarsFill } from 'react-icons/pi';

export default function Header({ showHomeTabs, homeTab, onHomeTabChange, onLogoClick }) {
  const { theme, toggle } = useTheme();

  return (
    <header className="header">

      {/* 좌: 로고 */}
      <button className="header-logo" onClick={onLogoClick} type="button">
        <img
          className="header-logo-img"
          src={theme === 'dark' ? '/media/logo_dark.png' : '/media/logo_light.png'}
          alt="DunNode"
          width={160}
          height={40}
        />
      </button>

      {/* 중앙: 홈 탭 (직업 미선택 시만) */}
      <nav className="header-center">
        {showHomeTabs && (
          <>
            {[['search', '캐릭터 검색'], ['job', '직업 선택']].map(([key, label]) => (
              <button
                key={key}
                className={`header-nav-tab${homeTab === key ? ' active' : ''}`}
                onClick={() => onHomeTabChange(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </>
        )}
      </nav>

      {/* 우: 테마 토글 */}
      <div className="header-right">
        <button
          className="theme-toggle"
          onClick={toggle}
          title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          type="button"
        >
          {theme === 'dark'
            ? <PiSunDimFill size={22} />
            : <PiMoonStarsFill size={22} />}
        </button>
      </div>

    </header>
  );
}
