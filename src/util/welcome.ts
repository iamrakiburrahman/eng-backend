import config from '../config';

export const welcome = () => {
     const date = new Date(Date.now());
     const hours = date.getHours();
     let greeting = '';

     // Time-based greeting
     if (hours < 12) {
          greeting = "Good morning! Let's get the day started!";
     } else if (hours < 18) {
          greeting = 'Good afternoon! Keep the momentum going!';
     } else {
          greeting = 'Good evening! Hope you had a fantastic day!';
     }

     return `
        <div class="welcome-container">
            <!-- Animated background elements -->
            <div class="bg-animation">
                <div class="floating-circle circle-1"></div>
                <div class="floating-circle circle-2"></div>
                <div class="floating-circle circle-3"></div>
                <div class="floating-circle circle-4"></div>
                <div class="floating-circle circle-5"></div>
            </div>

            <!-- Particle system -->
            <div class="particles">
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
                <div class="particle"></div>
            </div>

            <!-- Main content -->
            <div class="main-content">
                <!-- Header Section -->
                <div class="header-section">
                    <div class="server-icon">
                        <div class="server-glow"></div>
                        
                    </div>
                    <h1 class="main-title">
                        <span class="title-line">${config.server.name?.toUpperCase() || 'SERVER'}</span>
                        <span class="title-line">ONLINE</span>
                    </h1>
                    <div class="status-indicator">
                       <div class="heartbeat">
                       <div class="pulse-dot"></div>
                            <div class="heartbeat-line"></div>
                            <div class="heartbeat-line"></div>
                            <div class="heartbeat-line"></div>
                            <div class="heartbeat-line"></div>
                            <div class="pulse-dot"></div>
                        </div>
                        <span class="text-flex">LIVE & ACTIVE</span>
                        <div class="heartbeat">
                        <div class="pulse-dot"></div>
                            <div class="heartbeat-line"></div>
                            <div class="heartbeat-line"></div>
                            <div class="heartbeat-line"></div>
                            <div class="heartbeat-line"></div>
                            <div class="pulse-dot"></div>
                        </div>
                    </div>
                </div>

                <!-- Greeting Section -->
                <div class="greeting-section">
                    <div class="greeting-card">
                        <div class="card-glow"></div>
                        <p class="greeting-text">${greeting}</p>
                        <div class="time-display">
                            <span class="time-label">Current Time</span>
                            <span class="time-value">${date.toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                <!-- Features Grid -->
                <div class="features-grid">
                    <div class="feature-card">
                        <div class="feature-icon"></div>
                        <h3>Lightning Fast</h3>
                        <p>Optimized for speed</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon"></div>
                        <h3>Secure</h3>
                        <p>Protected & encrypted</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon"></div>
                        <h3>Global</h3>
                        <p>Worldwide accessibility</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon"></div>
                        <h3>Precise</h3>
                        <p>Accurate responses</p>
                    </div>
                </div>
                
                <!-- Developer Section -->
                <div class="developer-section">
                    <div class="developer-card interactive">
                        <div class="developer-title">Crafted with by</div>
                        <div class="developer-name">Md. Rakibur Rahman</div>
                        <div class="developer-badge">Full Stack Developer</div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="footer-section">
                    <div class="footer-message">
                        <span class="sparkle"></span>
                        Ready to serve your requests with style!
                        <span class="sparkle"></span>
                    </div>
                </div>
            </div>
        </div>

        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            .welcome-container {
                min-height: 100vh;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                position: relative;
                overflow: hidden;
                font-family: 'Inter', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }

            /* Animated Background */
            .bg-animation {
                position: absolute;
                width: 100%;
                height: 100%;
                top: 0;
                left: 0;
                z-index: 1;
            }
.text-flex{
    display: flex;
    align-items: center;
    gap: 10px;
}
            .floating-circle {
                position: absolute;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                animation: float 6s ease-in-out infinite;
            }

            .circle-1 {
                width: 80px;
                height: 80px;
                top: 20%;
                left: 10%;
                animation-delay: 0s;
            }

            .circle-2 {
                width: 120px;
                height: 120px;
                top: 60%;
                right: 10%;
                animation-delay: 2s;
            }

            .circle-3 {
                width: 60px;
                height: 60px;
                bottom: 20%;
                left: 20%;
                animation-delay: 4s;
            }

            .circle-4 {
                width: 100px;
                height: 100px;
                top: 10%;
                right: 30%;
                animation-delay: 1s;
            }

            .circle-5 {
                width: 140px;
                height: 140px;
                bottom: 30%;
                right: 40%;
                animation-delay: 3s;
            }

            /* Particle System */
            .particles {
                position: absolute;
                width: 100%;
                height: 100%;
                z-index: 2;
            }

            .particle {
                position: absolute;
                width: 4px;
                height: 4px;
                background: rgba(255, 255, 255, 0.8);
                border-radius: 50%;
                animation: particles 8s linear infinite;
            }

            .particle:nth-child(1) { left: 10%; animation-delay: 0s; }
            .particle:nth-child(2) { left: 20%; animation-delay: 1s; }
            .particle:nth-child(3) { left: 30%; animation-delay: 2s; }
            .particle:nth-child(4) { left: 40%; animation-delay: 3s; }
            .particle:nth-child(5) { left: 50%; animation-delay: 4s; }
            .particle:nth-child(6) { left: 60%; animation-delay: 5s; }
            .particle:nth-child(7) { left: 70%; animation-delay: 6s; }
            .particle:nth-child(8) { left: 80%; animation-delay: 7s; }

            /* Main Content */
            .main-content {
                position: relative;
                z-index: 10;
                max-width: 1200px;
                width: 100%;
                text-align: center;
                color: white;
            }

            /* Header Section */
            .header-section {
                margin-bottom: 60px;
                animation: slideUp 1s ease-out;
            }

            .server-icon {
                position: relative;
                display: inline-block;
                font-size: 80px;
                margin-bottom: 20px;
                animation: bounce 2s infinite;
            }

            .server-glow {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 120px;
                height: 120px;
                background: radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 70%);
                border-radius: 50%;
                animation: pulse 2s ease-in-out infinite;
            }

            .main-title {
                font-size: 4rem;
                font-weight: 800;
                margin-bottom: 20px;
                text-shadow: 0 0 30px rgba(255, 255, 255, 0.5);
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            .title-line {
                display: block;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4);
                background-size: 400% 400%;
                background-clip: text;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                animation: gradientShift 3s ease infinite;
            }

            .status-indicator {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                font-size: 1.2rem;
                font-weight: 600;
                letter-spacing: 2px;
            }

            .heartbeat {
                display: flex;
                align-items: center;
                height: 20px;
                position: relative;
            }

            .heartbeat-line {
                width: 6px;
                height: 6px;
                background: #00ff88;
                border-radius: 50%;
                margin: 0 2px;
                position: relative;
                animation: heartbeat 1.5s infinite;
            }

            .heartbeat-line:nth-child(1) { animation-delay: 0s; }
            .heartbeat-line:nth-child(2) { animation-delay: 0.2s; }
            .heartbeat-line:nth-child(3) { animation-delay: 0.4s; }

            .pulse-dot {
                width: 12px;
                height: 12px;
                background: #00ff88;
                border-radius: 50%;
                animation: pulse 1s infinite;
                box-shadow: 0 0 20px #00ff88;
                margin-left: 5px;
            }

            /* Greeting Section */
            .greeting-section {
                margin-bottom: 60px;
                animation: slideUp 1s ease-out 0.3s both;
            }

            .greeting-card {
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(20px);
                border-radius: 20px;
                padding: 40px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                position: relative;
                overflow: hidden;
                transition: transform 0.3s ease;
            }

            .greeting-card:hover {
                transform: translateY(-5px);
            }

            .card-glow {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(45deg, transparent, rgba(255, 255, 255, 0.1), transparent);
                animation: shine 3s infinite;
            }

            .greeting-text {
                font-size: 1.8rem;
                font-weight: 500;
                margin-bottom: 20px;
                position: relative;
                z-index: 2;
            }

            .time-display {
                position: relative;
                z-index: 2;
            }

            .time-label {
                display: block;
                font-size: 0.9rem;
                opacity: 0.8;
                margin-bottom: 5px;
            }

            .time-value {
                font-size: 1.3rem;
                font-weight: 600;
                color: #00ff88;
                text-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
            }

            /* Features Grid */
            .features-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 30px;
                margin-bottom: 60px;
                animation: slideUp 1s ease-out 0.6s both;
            }

            .feature-card {
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(15px);
                border-radius: 15px;
                padding: 30px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }

            .feature-card:hover {
                transform: translateY(-10px);
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
            }

            .feature-icon {
                font-size: 3rem;
                margin-bottom: 15px;
                animation: iconBounce 2s infinite;
            }

            .feature-card h3 {
                font-size: 1.3rem;
                font-weight: 600;
                margin-bottom: 10px;
            }

            .feature-card p {
                opacity: 0.9;
                font-size: 1rem;
            }

            /* Developer Section */
            .developer-section {
                margin-bottom: 40px;
                animation: slideUp 1s ease-out 0.9s both;
            }

            .developer-card {
                background: rgba(255, 255, 255, 0.15);
                backdrop-filter: blur(25px);
                border-radius: 25px;
                padding: 30px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                position: relative;
                overflow: hidden;
                transition: all 0.4s ease;
                max-width: 600px;
                margin: 0 auto;
            }

            .developer-card:hover {
                transform: translateY(-8px) scale(1.02);
                box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
            }

            .developer-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
                transition: left 0.5s ease;
            }

            .developer-card:hover::before {
                left: 100%;
            }

            .developer-title {
                font-size: 1.1rem;
                font-weight: 500;
                opacity: 0.9;
                margin-bottom: 10px;
                letter-spacing: 1px;
            }

            .developer-name {
                font-size: 2.2rem;
                font-weight: 700;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4, #feca57);
                background-size: 400% 400%;
                background-clip: text;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                animation: gradientShift 4s ease infinite;
                margin-bottom: 10px;
                position: relative;
                z-index: 2;
            }

            .developer-badge {
                display: inline-block;
                background: rgba(0, 255, 136, 0.2);
                color: #00ff88;
                padding: 8px 20px;
                border-radius: 25px;
                font-size: 0.9rem;
                font-weight: 600;
                border: 1px solid rgba(0, 255, 136, 0.3);
                position: relative;
                z-index: 2;
                animation: glow 2s ease-in-out infinite alternate;
            }

            /* Footer */
            .footer-section {
                animation: slideUp 1s ease-out 1.2s both;
            }

            .footer-message {
                font-size: 1.3rem;
                margin-bottom: 20px;
                font-weight: 500;
            }

            .sparkle {
                animation: sparkle 1.5s ease-in-out infinite;
            }

            /* Animations */
            @keyframes float {
                0%, 100% { transform: translateY(0px) rotate(0deg); }
                50% { transform: translateY(-20px) rotate(180deg); }
            }

            @keyframes particles {
                0% { transform: translateY(100vh) rotate(0deg); opacity: 0; }
                10% { opacity: 1; }
                90% { opacity: 1; }
                100% { transform: translateY(-100vh) rotate(360deg); opacity: 0; }
            }

            @keyframes slideUp {
                from { transform: translateY(50px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }

            @keyframes bounce {
                0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
                40% { transform: translateY(-10px); }
                60% { transform: translateY(-5px); }
            }

            @keyframes pulse {
                0% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.1); opacity: 0.7; }
                100% { transform: scale(1); opacity: 1; }
            }

            @keyframes heartbeat {
                0% { transform: scale(1); opacity: 0.4; }
                25% { transform: scale(1.3); opacity: 1; }
                50% { transform: scale(1); opacity: 0.4; }
                75% { transform: scale(1.3); opacity: 1; }
                100% { transform: scale(1); opacity: 0.4; }
            }

            @keyframes gradientShift {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }

            @keyframes shine {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
            }

            @keyframes iconBounce {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }

            @keyframes sparkle {
                0%, 100% { transform: scale(1) rotate(0deg); }
                50% { transform: scale(1.2) rotate(180deg); }
            }

            @keyframes glow {
                0% { box-shadow: 0 0 20px rgba(0, 255, 136, 0.3); }
                100% { box-shadow: 0 0 30px rgba(0, 255, 136, 0.6); }
            }

            /* Responsive Design */
            @media (max-width: 768px) {
                .main-title {
                    font-size: 2.5rem;
                }
                
                .features-grid {
                    grid-template-columns: 1fr;
                }
                
                .server-icon {
                    font-size: 60px;
                }
                
                .greeting-text {
                    font-size: 1.4rem;
                }
                    
                .developer-name {
                    font-size: 1.8rem;
                }
            }

            @media (max-width: 480px) {
                .main-title {
                    font-size: 2rem;
                }
                
                .greeting-card {
                    padding: 20px;
                }
                
                .feature-card {
                    padding: 20px;
                }
                    
                .developer-card {
                    padding: 20px;
                }

                .developer-name {
                    font-size: 1.5rem;
                }
            }
        </style>
    `;
};
