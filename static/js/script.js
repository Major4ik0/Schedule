document.addEventListener('mousemove', e => {
    Object.assign(document.documentElement, {
        style: `
		--move-x: ${(e.clientX - window.innerWidth / 2) * -.005}deg;
		--move-y: ${(e.clientY - window.innerHeight / 2) * .01}deg;
		`
    })
})

const loginBtn = document.getElementById('link-button');
const loginForm = document.getElementById('loginForm');
const generalBtn = document.getElementById('generalBtn');
const authBtnPrepods = document.getElementById('link-authBtnPrepods');
const layers = document.getElementById('layersT');

loginBtn.addEventListener('click', () => {
    if (generalBtn.classList.contains('active')) {
        loginForm.classList.remove('active');
        generalBtn.classList.remove('active');
        loginForm.style.display = 'none';
        generalBtn.style.display = 'none';
        loginBtn.textContent = 'Войти';
        layers.classList.remove('blur');
    } else {
        generalBtn.style.display = 'flex';
        generalBtn.classList.add('active');
        loginBtn.textContent = 'Закрыть';
        layers.classList.add('blur');
    }
})

authBtnPrepods.addEventListener('click', () => {
    if (loginForm.classList.contains('active')) {
        loginForm.classList.remove('active');
        loginForm.style.display = 'none';
    } else {
        loginForm.classList.add('active');
        loginForm.style.display = 'block';
    }

})

const enterAsUser = () => {
    window.location.href = "user";
}
document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const login = document.getElementById("loginS").value;
    const password = document.getElementById("passwordS").value;

    fetch('/api/check-admin-password', {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({login: login, password: password})
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = 'user';
            } else {
                alert(data.error);

            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Ошибка при проверке пароля');
        });
});
