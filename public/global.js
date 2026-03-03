function protectPage() {
    const path = window.location.pathname;
    const protectedPages = ['/avaliacao-usuario', '/dashboard', '/scanner', '/formulario', '/admin', '/avaliacao']; 
    const isProtected = protectedPages.some(p => path.startsWith(p));
    const token = localStorage.getItem('authToken');

    if (isProtected && !token) {
        Swal.fire({
            icon: 'warning',
            title: 'Acesso Restrito',
            width: '500px',
            html: `
                <div style="text-align: left; padding: 10px;">
                    <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 8px;">
                        <p style="margin: 0; color: #856404;">
                            <i class="fas fa-exclamation-triangle" style="margin-right: 8px;"></i>
                            Você precisa estar logado para acessar esta página.
                        </p>
                    </div>
                </div>
            `,
            confirmButtonText: 'Fazer Login',
            confirmButtonColor: '#27ae60',
            allowOutsideClick: false,
            customClass: {
                popup: 'swal-custom-popup',
                title: 'swal-custom-title',
                confirmButton: 'swal-custom-confirm'
            }
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
                    iconColor: 'var(--azul-gov-principal)',
                    title: 'Confirmar Saída',
                    width: '500px',
                    html: `
                        <div style="text-align: left; padding: 10px;">
                            <div style="background: #e8f4fd; border-left: 4px solid #002776; padding: 15px; border-radius: 8px;">
                                <p style="margin: 0; color: #2c3e50;">
                                    <i class="fas fa-info-circle" style="color: #002776; margin-right: 8px;"></i>
                                    Você tem certeza que deseja encerrar a sessão?
                                </p>
                            </div>
                        </div>
                    `,
                    showCancelButton: true,
                    confirmButtonText: 'Sim, Sair',
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: '#dc3545',
                    cancelButtonColor: '#7f8c8d',
                    reverseButtons: true,
                    customClass: {
                        popup: 'swal-custom-popup',
                        title: 'swal-custom-title',
                        confirmButton: 'swal-custom-confirm',
                        cancelButton: 'swal-custom-cancel'
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        localStorage.removeItem('authToken');
                        Swal.fire({
                            icon: 'success',
                            title: 'Você saiu!',
                            width: '500px',
                            html: `
                                <div style="text-align: left; padding: 10px;">
                                    <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 15px; border-radius: 8px;">
                                        <p style="margin: 0; color: #155724;">
                                            <i class="fas fa-check-circle" style="margin-right: 8px;"></i>
                                            Sua sessão foi encerrada com sucesso.
                                        </p>
                                    </div>
                                </div>
                            `,
                            timer: 2000,
                            showConfirmButton: false,
                            customClass: {
                                popup: 'swal-custom-popup',
                                title: 'swal-custom-title'
                            }
                        });
                        setTimeout(() => { window.location.href = '/'; }, 2000);
                    }
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