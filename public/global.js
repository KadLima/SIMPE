function protectPage() {
    const path = window.location.pathname;
    const protectedPages = ['/avaliacao-usuario', '/dashboard', '/scanner', '/formulario', '/admin', '/avaliacao']; 
    const isProtected = protectedPages.some(p => path.startsWith(p));
    const token = localStorage.getItem('authToken');

    if (isProtected && !token) {
        Swal.fire({
            icon: 'warning',
            title: 'Acesso Restrito',
            text: 'Você precisa estar logado para acessar esta página.',
            confirmButtonText: 'Fazer Login',
            confirmButtonColor: '#002776',
            allowOutsideClick: false
        }).then(() => {
            window.location.href = '/login';
        });
        return; 
    }

    /*const dataLiberacao = new Date('2025-11-14T00:00:00');
    const hoje = new Date();

    if (path.startsWith('/formulario') && hoje < dataLiberacao) {
        fetch('/verify-token', {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(data => {
            if (data.user && data.user.role !== 'ADMIN') {
                Swal.fire({
                    icon: 'info',
                    iconColor: '#002776',
                    title: 'Aguarde a Liberação',
                    html: `A Autoavaliação estará disponível a partir de <strong>14 de Novembro de 2025</strong>.<br>Agradecemos a sua compreensão.`,
                    confirmButtonText: 'Voltar ao Início',
                    confirmButtonColor: '#002776',
                    allowOutsideClick: false
                }).then(() => {
                    window.location.href = '/';
                });
            }
        });
    }*/
}

async function setupDynamicLinks() {
    const navLinks = document.getElementById('nav-links');
    const token = localStorage.getItem('authToken');
    let isLoggedIn = false;
    let user = null;

    if (token) {
        try {
            const response = await fetch('/verify-token', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                isLoggedIn = true;
                user = (await response.json()).user;
            } else {
                localStorage.removeItem('authToken');
            }
        } catch (error) { /* Assume deslogado */ }
    }

    if (isLoggedIn && user) {
        if (navLinks) {
            let menuHTML = `
                <li><a href="/">Início</a></li>
                <li><a href="/dashboard">Minha Área</a></li>
            `;
            
            if (user.role === 'ADMIN' || user.role === 'GESTOR') {
                menuHTML += `
                <li><a href="/admin">Área Administrativa</a></li>
                <li><a href="/scanner">Scanner de Links</a></li>`;
            }
            
            menuHTML += `
                
                <li><a href="/formulario">Autoavaliação</a></li>
                <li><a id="logout-btn" href="#">Sair</a></li>
            `;
            
            navLinks.innerHTML = menuHTML;
        }
        
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (event) => {
                event.preventDefault();
                Swal.fire({
                    icon: 'question',
                    iconColor: '#002776', 
                    title: 'Confirmar Saída',
                    text: 'Você tem certeza que deseja encerrar a sessão?',
                    showCancelButton: true,
                    confirmButtonText: 'Sim, Sair',
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: '#dc3545', 
                    cancelButtonColor: '#6c757d'
                }).then((result) => {
                    if (result.isConfirmed) {
                        localStorage.removeItem('authToken');
                        Swal.fire({
                            icon: 'info',
                            iconColor: '#002776', 
                            title: 'Você saiu!',
                            text: 'Sua sessão foi encerrada com sucesso.',
                            timer: 1500,
                            showConfirmButton: false
                        });
                        setTimeout(() => { window.location.href = '/'; }, 1500);
                    }
                });
            });
        }
    } else {
        if (navLinks) {
            navLinks.innerHTML = `
                <li><a href="/">Início</a></li>
                <li><a href="/scanner">Scanner de Links</a></li>
                <li><a href="/login" style="font-weight: bold;">Login</a></li>
            `;
        }
    }
    
    setupHomePageLinks(isLoggedIn);
    setupFooterLink(isLoggedIn, user); 
}

function setupHomePageLinks(isLoggedIn) {
    const formCardLink = document.getElementById('form-card-link');
    if (formCardLink) {
        if (isLoggedIn) {
            formCardLink.href = '/formulario';
        } else {
            formCardLink.href = '/login';
        }
    }
}

function setupFooterLink(isLoggedIn, user) {
    const adminFooterLink = document.getElementById('admin-footer-link');
    if (!adminFooterLink) return;

    if (isLoggedIn && user && (user.role === 'ADMIN' || user.role === 'GESTOR')) {
        adminFooterLink.style.display = 'inline';
        adminFooterLink.href = '/admin';
    } else {
        adminFooterLink.style.display = 'none';
    }
}

protectPage();
document.addEventListener('DOMContentLoaded', setupDynamicLinks);