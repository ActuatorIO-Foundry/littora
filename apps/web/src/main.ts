import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Routes } from '@angular/router';
import { AppComponent } from './app/app.component';
import { HomeComponent } from './app/pages/home/home.component';
import { BeachDetailComponent } from './app/pages/beach-detail/beach-detail.component';

const routes: Routes = [
    { path: '', component: HomeComponent },
    { path: 'plages/:id', component: BeachDetailComponent },
    { path: '**', redirectTo: '' }
];
bootstrapApplication(AppComponent, { providers: [provideHttpClient(), provideRouter(routes)] }).catch(console.error);
